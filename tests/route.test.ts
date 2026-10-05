/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed fakes and JSON assertions */
import "./env";
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it, mock } from "node:test";
import { cleanupTestTickets, closeDb, mockGemini, testEmail } from "./helpers";
import { POST } from "../src/app/api/agent/route";

afterEach(cleanupTestTickets);
after(closeDb);

const post = (body: string) => POST(new Request("http://localhost/api/agent", { method: "POST", body }));
const valid = () => JSON.stringify({ email: testEmail(), message: "I was charged twice" });

describe("POST /api/agent", () => {
  beforeEach(() => {
    // The route logs unexpected errors; keep test output clean.
    mock.method(console, "error", () => {});
  });
  afterEach(() => mock.restoreAll());

  it("returns 400 for malformed JSON", async () => {
    const res = await post("{nope");
    assert.equal(res.status, 400);
  });

  it("returns 400 with a readable message for invalid input", async () => {
    const res = await post(JSON.stringify({ email: "nope", message: "hi" }));
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /email/i);
  });

  it("returns 500 when the API key is missing", async () => {
    const key = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const res = await post(valid());
      assert.equal(res.status, 500);
      assert.match((await res.json()).error, /GEMINI_API_KEY/);
    } finally {
      process.env.GEMINI_API_KEY = key;
    }
  });

  it("returns 502 when the agent creates no ticket", async () => {
    mockGemini([{ text: "no tools" }]);
    assert.equal((await post(valid())).status, 502);
  });

  it("returns 502 with a generic message when Gemini fails", async () => {
    mockGemini([{ fail: true }]);
    const res = await post(valid());
    assert.equal(res.status, 502);
    assert.doesNotMatch((await res.json()).error, /upstream failure|test-key/);
  });

  it("returns 200 with the ticket and trace when Gemini fails after the ticket was created", async () => {
    mockGemini([
      { calls: [{ name: "lookup_customer", args: { email: "carol@example.com" } }] },
      {
        calls: [
          {
            name: "create_ticket",
            args: { category: "account", priority: "low", summary: "s", suggestedResponse: "r" },
          },
        ],
      },
      { fail: true },
    ]);
    const res = await post(valid());
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ticket.category, "account");
    assert.deepEqual(data.toolCalls.map((t: any) => t.name), ["lookup_customer", "create_ticket"]);
    assert.equal(data.finalText, undefined);
  });

  it("returns the ticket, tool-call trace and final text on success", async () => {
    mockGemini([
      { calls: [{ name: "lookup_customer", args: { email: "carol@example.com" } }] },
      {
        calls: [
          {
            name: "create_ticket",
            args: { category: "account", priority: "low", summary: "s", suggestedResponse: "r" },
          },
        ],
      },
      { text: "Ticket created." },
    ]);
    const res = await post(valid());
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ticket.category, "account");
    assert.deepEqual(data.toolCalls.map((t: any) => t.name), ["lookup_customer", "create_ticket"]);
    assert.equal(data.finalText, "Ticket created.");
  });
});
