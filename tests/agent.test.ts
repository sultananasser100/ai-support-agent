/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed fakes and JSON assertions */
import "./env";
import assert from "node:assert/strict";
import { after, afterEach, describe, it, mock } from "node:test";
import { cleanupTestTickets, closeDb, db, mockGemini, testEmail } from "./helpers";
import { AgentError, ConfigError, runAgent } from "../src/lib/agent";

afterEach(cleanupTestTickets);
after(closeDb);

const goodTicket = {
  category: "billing",
  priority: "high",
  summary: "Charged twice",
  suggestedResponse: "The second charge is a temporary authorization.",
};

describe("runAgent", () => {
  it("runs the tool-calling loop, persists the trace and links the customer", async () => {
    const alice = await db.customer.findUniqueOrThrow({ where: { email: "alice@example.com" } });
    const sent = mockGemini([
      { calls: [{ name: "lookup_customer", args: { email: "alice@example.com" } }] },
      { calls: [{ name: "search_knowledge_base", args: { query: "charged twice invoice" } }] },
      { calls: [{ name: "create_ticket", args: { ...goodTicket, customerId: alice.id } }] },
      { text: "Ticket created." },
    ]);
    const request = { email: testEmail(), message: "I was charged twice" };

    const { ticket, toolCalls, finalText } = await runAgent(request);

    assert.deepEqual(toolCalls.map((t) => t.name), ["lookup_customer", "search_knowledge_base", "create_ticket"]);
    assert.equal(finalText, "Ticket created.");
    assert.equal(ticket.customerId, alice.id);
    assert.equal(ticket.email, request.email);
    assert.equal(ticket.category, "billing");

    const stored = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    assert.deepEqual(stored.toolCalls, JSON.parse(JSON.stringify(toolCalls)));

    // Gemini request shape: model, declarations, auto function-calling.
    assert.equal(sent.length, 4);
    assert.match(sent[0].url, /models\/gemini-3\.8-flash:generateContent/);
    assert.deepEqual(
      sent[0].body.tools[0].functionDeclarations.map((d: any) => d.name),
      ["lookup_customer", "search_knowledge_base", "create_ticket"],
    );
    assert.equal(sent[0].body.toolConfig.functionCallingConfig.mode, "AUTO");
  });

  it("replays the model's turn (with its thought signature) and answers with the matching call id", async () => {
    const sent = mockGemini([
      { calls: [{ name: "lookup_customer", args: { email: "bob@example.com" } }] },
      { calls: [{ name: "create_ticket", args: goodTicket }] },
      { text: "done" },
    ]);
    await runAgent({ email: testEmail(), message: "hello" });

    const secondRequest = sent[1].body.contents;
    assert.deepEqual(secondRequest.map((c: any) => c.role), ["user", "model", "user"]);
    assert.equal(secondRequest[1].parts[0].thoughtSignature, "sig-1-0");
    const reply = secondRequest[2].parts[0].functionResponse;
    assert.equal(reply.name, "lookup_customer");
    assert.equal(reply.id, "call-1-0");
    assert.equal(reply.response.output.found, true);
  });

  it("feeds tool errors back to the model and lets it recover", async () => {
    const sent = mockGemini([
      { calls: [{ name: "create_ticket", args: { ...goodTicket, category: "sales" } }] },
      { calls: [{ name: "create_ticket", args: goodTicket }] },
      { text: "done" },
    ]);
    const { toolCalls, ticket } = await runAgent({ email: testEmail(), message: "hello" });

    assert.match((toolCalls[0].result as any).error, /Invalid arguments/);
    assert.ok((toolCalls[1].result as any).ticketId);
    assert.ok(sent[1].body.contents[2].parts[0].functionResponse.response.error);
    assert.equal(ticket.category, "billing");
  });

  it("throws AgentError when the model never creates a ticket", async () => {
    mockGemini([{ text: "I cannot help with that." }]);
    await assert.rejects(runAgent({ email: testEmail(), message: "hello" }), AgentError);
  });

  it("stops after the step limit instead of looping forever", async () => {
    const lookup = { calls: [{ name: "lookup_customer", args: { email: "a@b.co" } }] };
    const sent = mockGemini(Array.from({ length: 10 }, () => lookup));
    await assert.rejects(runAgent({ email: testEmail(), message: "hello" }), AgentError);
    assert.equal(sent.length, 5);
  });

  it("throws ConfigError when the API key is missing", async () => {
    const key = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      await assert.rejects(runAgent({ email: testEmail(), message: "hello" }), ConfigError);
    } finally {
      process.env.GEMINI_API_KEY = key;
    }
  });

  it("propagates upstream Gemini failures", async () => {
    mockGemini([{ fail: true }]);
    await assert.rejects(runAgent({ email: testEmail(), message: "hello" }), (err) => {
      return !(err instanceof AgentError) && !(err instanceof ConfigError);
    });
  });

  it("rejects invalid input before calling Gemini", async () => {
    const sent = mockGemini([]);
    await assert.rejects(runAgent({ email: "nope", message: "hello" }));
    assert.equal(sent.length, 0);
  });
});

describe("runAgent when Gemini fails mid-run", () => {
  afterEach(() => mock.restoreAll());

  it("returns the ticket with its full trace when the closing call fails after create_ticket", async () => {
    const logged = mock.method(console, "error", () => {});
    mockGemini([
      { calls: [{ name: "lookup_customer", args: { email: "bob@example.com" } }] },
      { calls: [{ name: "create_ticket", args: goodTicket }] },
      { fail: true },
    ]);
    const request = { email: testEmail(), message: "hello" };

    const { ticket, toolCalls, finalText } = await runAgent(request);

    assert.equal(finalText, undefined);
    assert.deepEqual(toolCalls.map((t) => t.name), ["lookup_customer", "create_ticket"]);
    assert.equal(logged.mock.callCount(), 1);

    const stored = await db.ticket.findMany({ where: { email: request.email } });
    assert.equal(stored.length, 1);
    assert.equal(stored[0].id, ticket.id);
    assert.deepEqual(stored[0].toolCalls, JSON.parse(JSON.stringify(toolCalls)));
  });

  it("still rejects and creates no ticket when Gemini fails before create_ticket", async () => {
    const logged = mock.method(console, "error", () => {});
    mockGemini([
      { calls: [{ name: "lookup_customer", args: { email: "bob@example.com" } }] },
      { fail: true },
    ]);
    const request = { email: testEmail(), message: "hello" };

    await assert.rejects(runAgent(request), (err) => {
      return !(err instanceof AgentError) && !(err instanceof ConfigError);
    });

    assert.equal(logged.mock.callCount(), 0);
    assert.equal(await db.ticket.count({ where: { email: request.email } }), 0);
  });

  it("includes tool calls made after create_ticket in the stored trace", async () => {
    const request = { email: testEmail(), message: "hello" };
    const sent = mockGemini([
      { calls: [{ name: "create_ticket", args: goodTicket }] },
      { calls: [{ name: "lookup_customer", args: { email: "bob@example.com" } }] },
      { fail: true },
    ]);
    mock.method(console, "error", () => {});
    const result = await runAgent(request);
    assert.equal(sent.length, 3);
    assert.deepEqual(result.toolCalls.map((t) => t.name), ["create_ticket", "lookup_customer"]);
    const stored = await db.ticket.findUniqueOrThrow({ where: { id: result.ticket.id } });
    assert.equal((stored.toolCalls as unknown[]).length, 2);
  });
});
