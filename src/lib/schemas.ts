import { z } from "zod";

export const requestInputSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  message: z.string().trim().min(1).max(2000),
});
export type RequestInput = z.infer<typeof requestInputSchema>;

export const categorySchema = z.enum(["billing", "technical", "account", "other"]);
export const prioritySchema = z.enum(["low", "medium", "high"]);

// Tool argument schemas. These are the single source of truth: tools.ts turns
// them into the Gemini function declarations and re-validates the model's args.
export const lookupCustomerArgsSchema = z.object({
  email: z.string().describe("The customer's email address."),
});

export const searchKnowledgeBaseArgsSchema = z.object({
  query: z.string().min(1).describe("Keywords describing the customer's problem."),
});

export const createTicketArgsSchema = z.object({
  category: categorySchema.describe("The category that best fits the request."),
  priority: prioritySchema.describe(
    "high for outages, security problems, or money lost; low for general questions.",
  ),
  summary: z.string().min(1).describe("One or two sentences summarizing the request."),
  suggestedResponse: z
    .string()
    .min(1)
    .describe("A reply to the customer that an agent could send, using the knowledge base."),
  customerId: z
    .string()
    .optional()
    .describe("The customer id returned by lookup_customer, if the customer was found."),
});

export type ToolCallRecord = {
  name: string;
  args: unknown;
  result: unknown;
};
