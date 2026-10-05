import { z } from "zod";
import { AgentError, ConfigError, runAgent } from "@/lib/agent";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  try {
    const { ticket, toolCalls, finalText } = await runAgent(body);
    return Response.json({ ticket, toolCalls, finalText });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: z.prettifyError(err) }, { status: 400 });
    }
    if (err instanceof ConfigError) {
      return Response.json({ error: err.message }, { status: 500 });
    }
    if (err instanceof AgentError) {
      return Response.json({ error: err.message }, { status: 502 });
    }
    console.error("Agent request failed:", err);
    return Response.json({ error: "The agent request failed. Please try again." }, { status: 502 });
  }
}
