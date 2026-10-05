import type { FunctionDeclaration } from "@google/genai";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  createTicketArgsSchema,
  lookupCustomerArgsSchema,
  searchKnowledgeBaseArgsSchema,
  type RequestInput,
} from "@/lib/schemas";

function declaration(name: string, description: string, schema: z.ZodType): FunctionDeclaration {
  const parametersJsonSchema: Record<string, unknown> = z.toJSONSchema(schema, { io: "input" });
  delete parametersJsonSchema.$schema;
  return { name, description, parametersJsonSchema };
}

const declarations: FunctionDeclaration[] = [
  declaration(
    "lookup_customer",
    "Look up a customer account by email address. Returns the customer's id, name, and plan, or found: false.",
    lookupCustomerArgsSchema,
  ),
  declaration(
    "search_knowledge_base",
    "Search the support knowledge base for articles relevant to the customer's problem. Returns up to 3 articles.",
    searchKnowledgeBaseArgsSchema,
  ),
  declaration(
    "create_ticket",
    "Create the support ticket with your classification, priority, summary, and suggested response. Call this exactly once, after gathering information.",
    createTicketArgsSchema,
  ),
];

// Tools for one agent run. The original email/message come from the validated
// request, not from the model's arguments.
export function createTools(request: RequestInput) {
  let ticketId: string | undefined;

  async function lookupCustomer(rawArgs: unknown) {
    const { email } = lookupCustomerArgsSchema.parse(rawArgs);
    const customer = await db.customer.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, name: true, email: true, plan: true },
    });
    return customer ? { found: true, customer } : { found: false };
  }

  async function searchKnowledgeBase(rawArgs: unknown) {
    const { query } = searchKnowledgeBaseArgsSchema.parse(rawArgs);
    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .filter((term) => term.length > 2);
    if (terms.length === 0) return { articles: [] };

    const matches = await db.knowledgeArticle.findMany({
      where: {
        OR: terms.flatMap((term) => [
          { title: { contains: term, mode: "insensitive" as const } },
          { content: { contains: term, mode: "insensitive" as const } },
        ]),
      },
    });
    const score = (a: { title: string; content: string }) => {
      const text = `${a.title} ${a.content}`.toLowerCase();
      return terms.filter((term) => text.includes(term)).length;
    };
    const articles = matches
      .sort((a, b) => score(b) - score(a))
      .slice(0, 3)
      .map(({ title, content }) => ({ title, content }));
    return { articles };
  }

  async function createTicket(rawArgs: unknown) {
    if (ticketId) return { error: "A ticket was already created for this request." };
    const args = createTicketArgsSchema.parse(rawArgs);
    const customer = args.customerId
      ? await db.customer.findUnique({ where: { id: args.customerId }, select: { id: true } })
      : null;
    const ticket = await db.ticket.create({
      data: {
        customerId: customer?.id ?? null,
        email: request.email,
        message: request.message,
        category: args.category,
        priority: args.priority,
        summary: args.summary,
        suggestedResponse: args.suggestedResponse,
        toolCalls: [],
      },
    });
    ticketId = ticket.id;
    return { ticketId: ticket.id, customerLinked: customer !== null };
  }

  const handlers: Record<string, (args: unknown) => Promise<unknown>> = {
    lookup_customer: lookupCustomer,
    search_knowledge_base: searchKnowledgeBase,
    create_ticket: createTicket,
  };

  // Failures are returned to the model as an { error } result so it can recover.
  async function execute(name: string, args: unknown): Promise<unknown> {
    const handler = handlers[name];
    if (!handler) return { error: `Unknown tool: ${name}` };
    try {
      return await handler(args ?? {});
    } catch (err) {
      if (err instanceof z.ZodError) return { error: `Invalid arguments: ${z.prettifyError(err)}` };
      throw err;
    }
  }

  return { declarations, execute, getTicketId: () => ticketId };
}
