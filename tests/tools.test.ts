/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed fakes and JSON assertions */
import "./env";
import assert from "node:assert/strict";
import { after, afterEach, describe, it } from "node:test";
import { cleanupTestTickets, closeDb, db, testEmail } from "./helpers";
import { createTools } from "../src/lib/tools";

// These tests read the seeded data (npm run db:seed) and only write tickets,
// which are removed after every test.
afterEach(cleanupTestTickets);
after(closeDb);

const newTools = () => createTools({ email: testEmail(), message: "Original customer message" });

describe("lookup_customer", () => {
  it("finds a seeded customer regardless of email case", async () => {
    const result: any = await newTools().execute("lookup_customer", { email: " Alice@Example.com " });
    assert.equal(result.found, true);
    assert.equal(result.customer.name, "Alice Johnson");
    assert.equal(result.customer.plan, "pro");
  });

  it("returns found: false for an unknown email", async () => {
    const result: any = await newTools().execute("lookup_customer", { email: "nobody@example.com" });
    assert.deepEqual(result, { found: false });
  });
});

describe("search_knowledge_base", () => {
  it("returns the most relevant articles first, at most 3", async () => {
    const result: any = await newTools().execute("search_knowledge_base", {
      query: "I was charged twice on my invoice",
    });
    assert.ok(result.articles.length >= 1 && result.articles.length <= 3);
    assert.match(result.articles[0].title, /invoice/i);
  });

  it("finds the password article for a reset question", async () => {
    const result: any = await newTools().execute("search_knowledge_base", { query: "reset password" });
    assert.match(result.articles[0].title, /password/i);
  });

  it("returns no articles for unmatched or too-short queries", async () => {
    const tools = newTools();
    assert.deepEqual(await tools.execute("search_knowledge_base", { query: "zzzyyyxxx" }), { articles: [] });
    assert.deepEqual(await tools.execute("search_knowledge_base", { query: "a b" }), { articles: [] });
  });
});

describe("create_ticket", () => {
  const args = {
    category: "billing",
    priority: "high",
    summary: "Charged twice",
    suggestedResponse: "Wait 3-5 days",
  };

  it("stores the request's email and message, not model-supplied values, and links the customer", async () => {
    const request = { email: testEmail(), message: "Original customer message" };
    const tools = createTools(request);
    const bob = await db.customer.findUniqueOrThrow({ where: { email: "bob@example.com" } });

    const result: any = await tools.execute("create_ticket", {
      ...args,
      customerId: bob.id,
      email: "model-made-up@example.com",
      message: "model-made-up",
    });

    assert.equal(result.customerLinked, true);
    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: result.ticketId } });
    assert.equal(ticket.email, request.email);
    assert.equal(ticket.message, request.message);
    assert.equal(ticket.customerId, bob.id);
    assert.equal(tools.getTicketId(), ticket.id);
  });

  it("creates the ticket without a customer when the id is unknown", async () => {
    const result: any = await newTools().execute("create_ticket", { ...args, customerId: "does-not-exist" });
    assert.equal(result.customerLinked, false);
    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: result.ticketId } });
    assert.equal(ticket.customerId, null);
  });

  it("rejects invalid arguments without creating a ticket", async () => {
    const tools = newTools();
    const result: any = await tools.execute("create_ticket", { ...args, category: "sales" });
    assert.match(result.error, /Invalid arguments/);
    assert.equal(tools.getTicketId(), undefined);
  });

  it("refuses to create a second ticket in the same run", async () => {
    const tools = newTools();
    await tools.execute("create_ticket", args);
    const second: any = await tools.execute("create_ticket", args);
    assert.match(second.error, /already created/);
  });

  it("returns an error result for an unknown tool", async () => {
    const result: any = await newTools().execute("delete_everything", {});
    assert.match(result.error, /Unknown tool/);
  });
});
