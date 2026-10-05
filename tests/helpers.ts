/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed fakes and JSON assertions */
import "./env";
import { db } from "../src/lib/db";

export { db };

// Every ticket created by a test uses an email on this domain, so cleanup can
// remove them even when a test fails before it knows the ticket id.
export const TEST_DOMAIN = "tests.invalid";
let counter = 0;
export const testEmail = () => `case-${Date.now()}-${counter++}@${TEST_DOMAIN}`;

export async function cleanupTestTickets() {
  await db.ticket.deleteMany({ where: { email: { endsWith: `@${TEST_DOMAIN}` } } });
}

export async function closeDb() {
  await cleanupTestTickets();
  await db.$disconnect();
}

export type Step = {
  calls?: { name: string; args: Record<string, unknown> }[];
  text?: string;
  fail?: boolean;
};

// Replaces fetch with a scripted fake of the Gemini generateContent endpoint,
// so the real SDK request/response handling runs but nothing leaves the process.
export function mockGemini(steps: Step[]) {
  const sent: { url: string; body: any }[] = [];
  let i = 0;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const step = steps[i++];
    if (!step) throw new Error("Fake Gemini: no more scripted steps");
    if (step.fail) {
      return new Response(
        JSON.stringify({ error: { code: 500, message: "upstream failure", status: "INTERNAL" } }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
    const parts = step.calls
      ? step.calls.map((c, n) => ({
          functionCall: { id: `call-${i}-${n}`, ...c },
          thoughtSignature: `sig-${i}-${n}`,
        }))
      : [{ text: step.text ?? "" }];
    return new Response(
      JSON.stringify({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  return sent;
}
