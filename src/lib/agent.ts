import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type Content,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requestInputSchema, type ToolCallRecord } from "@/lib/schemas";
import { createTools } from "@/lib/tools";

const MAX_STEPS = 5;

const SYSTEM_INSTRUCTION = `You are a customer support agent. You receive one support request and must turn it into a support ticket.
Use your tools:
1. lookup_customer with the customer's email.
2. search_knowledge_base for articles relevant to the problem.
3. create_ticket exactly once, with the category, priority, a short summary, and a suggested reply to the customer that uses the knowledge base articles you found.
Do not invent customer details or policies that are not in the tool results. After create_ticket succeeds, reply with one short sentence confirming the ticket was created.`;

export type GenerateContent = (params: GenerateContentParameters) => Promise<GenerateContentResponse>;

// The server is missing required configuration.
export class ConfigError extends Error {}
// The agent ran but could not produce a ticket.
export class AgentError extends Error {}

function defaultGenerateContent(): GenerateContent {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ConfigError("GEMINI_API_KEY is not set");
  const ai = new GoogleGenAI({ apiKey });
  return (params) => ai.models.generateContent(params);
}

// Runs the Gemini function-calling loop for one support request. Gemini decides
// which tools to call; this code only executes them and feeds the results back.
export async function runAgent(input: unknown, generateContent?: GenerateContent) {
  const request = requestInputSchema.parse(input);
  const generate = generateContent ?? defaultGenerateContent();
  const model = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
  const tools = createTools(request);
  const toolCalls: ToolCallRecord[] = [];

  const contents: Content[] = [
    {
      role: "user",
      parts: [{ text: `Customer email: ${request.email}\n\nMessage:\n${request.message}` }],
    },
  ];

  let finalText: string | undefined;
  let ticket: Awaited<ReturnType<typeof db.ticket.update>> | undefined;
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      let response: GenerateContentResponse;
      try {
        response = await generate({
          model,
          contents,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            tools: [{ functionDeclarations: tools.declarations }],
            toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
            automaticFunctionCalling: { disable: true },
          },
        });
      } catch (err) {
        // Once the ticket exists the work is done; only the closing reply is missing.
        if (!tools.getTicketId()) throw err;
        console.error("Gemini call failed after the ticket was created:", err);
        break;
      }

      const calls = response.functionCalls ?? [];
      if (calls.length === 0) {
        finalText = response.text;
        break;
      }

      // Replay the model's turn unchanged (keeps Gemini 3 thought signatures).
      const modelContent = response.candidates?.[0]?.content;
      if (!modelContent) throw new AgentError("Gemini returned a function call without content");
      contents.push(modelContent);

      const responseParts: Part[] = [];
      for (const call of calls) {
        const name = call.name ?? "";
        const result = await tools.execute(name, call.args);
        toolCalls.push({ name, args: call.args ?? {}, result });
        const isError = typeof result === "object" && result !== null && "error" in result;
        responseParts.push({
          functionResponse: {
            id: call.id,
            name,
            response: isError ? { error: (result as { error: unknown }).error } : { output: result },
          },
        });
      }
      contents.push({ role: "user", parts: responseParts });
    }
  } finally {
    // Whatever happened, a ticket that exists must keep the trace of how it was made.
    const ticketId = tools.getTicketId();
    if (ticketId) {
      ticket = await db.ticket.update({
        where: { id: ticketId },
        data: { toolCalls: toolCalls as Prisma.InputJsonValue },
      });
    }
  }

  if (!ticket) throw new AgentError("The agent finished without creating a ticket");
  return { ticket, toolCalls, finalText };
}
