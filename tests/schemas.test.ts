import "./env";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTicketArgsSchema,
  requestInputSchema,
  searchKnowledgeBaseArgsSchema,
} from "../src/lib/schemas";

describe("requestInputSchema", () => {
  it("trims and lowercases the email and trims the message", () => {
    const parsed = requestInputSchema.parse({ email: "  Alice@Example.COM ", message: "  help  " });
    assert.deepEqual(parsed, { email: "alice@example.com", message: "help" });
  });

  it("rejects an invalid email, an empty message and an oversized message", () => {
    assert.equal(requestInputSchema.safeParse({ email: "nope", message: "hi" }).success, false);
    assert.equal(requestInputSchema.safeParse({ email: "a@b.co", message: "   " }).success, false);
    assert.equal(
      requestInputSchema.safeParse({ email: "a@b.co", message: "x".repeat(2001) }).success,
      false,
    );
  });
});

describe("tool argument schemas", () => {
  const valid = {
    category: "billing",
    priority: "high",
    summary: "Charged twice",
    suggestedResponse: "Wait 3-5 days",
  };

  it("accepts a valid create_ticket call with and without customerId", () => {
    assert.equal(createTicketArgsSchema.safeParse(valid).success, true);
    assert.equal(createTicketArgsSchema.safeParse({ ...valid, customerId: "abc" }).success, true);
  });

  it("rejects an unknown category or priority and missing fields", () => {
    assert.equal(createTicketArgsSchema.safeParse({ ...valid, category: "sales" }).success, false);
    assert.equal(createTicketArgsSchema.safeParse({ ...valid, priority: "urgent" }).success, false);
    assert.equal(createTicketArgsSchema.safeParse({ ...valid, summary: undefined }).success, false);
  });

  it("requires a non-empty search query", () => {
    assert.equal(searchKnowledgeBaseArgsSchema.safeParse({ query: "" }).success, false);
    assert.equal(searchKnowledgeBaseArgsSchema.safeParse({ query: "refund" }).success, true);
  });
});
