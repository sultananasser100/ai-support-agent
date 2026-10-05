"use client";

import { useState } from "react";

type ToolCall = { name: string; args: unknown; result: unknown };
type Result = {
  ticket: {
    customerId: string | null;
    category: string;
    priority: string;
    summary: string;
    suggestedResponse: string;
  };
  toolCalls: ToolCall[];
  finalText?: string;
};

const samples = [
  {
    label: "Billing issue (known customer)",
    email: "alice@example.com",
    message: "I was charged twice for my Pro subscription this month. Can you help?",
  },
  {
    label: "Unknown customer",
    email: "newperson@example.com",
    message: "I forgot my password and the reset email never arrives.",
  },
  {
    label: "Vague message",
    email: "bob@example.com",
    message: "it doesn't work",
  },
];

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";
const cardClass = "rounded-lg border border-zinc-200 p-5 dark:border-zinc-800";

export default function Home() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, message }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Something went wrong.");
      else setResult(data);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <h1 className="text-2xl font-semibold">AI Support Agent</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Submit a support request. A Gemini agent looks up the customer, searches the knowledge base,
        and creates a ticket using tool calls.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-500">Try an example:</span>
        {samples.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => {
              setEmail(s.email);
              setMessage(s.message);
            }}
            className="rounded-full border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            {s.label}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <label className="block text-sm font-medium">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="alice@example.com"
            className={`${inputClass} mt-1 font-normal`}
          />
        </label>
        <label className="block text-sm font-medium">
          Message
          <textarea
            required
            rows={5}
            maxLength={2000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="I was charged twice this month..."
            className={`${inputClass} mt-1 font-normal`}
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {loading ? "Agent is working…" : "Submit request"}
        </button>
      </form>

      {error && (
        <div
          role="alert"
          className="mt-6 whitespace-pre-wrap rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </div>
      )}

      {result && (
        <div className="mt-8 space-y-6">
          <section className={cardClass}>
            <h2 className="text-lg font-semibold">Ticket created</h2>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
                category: {result.ticket.category}
              </span>
              <span className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
                priority: {result.ticket.priority}
              </span>
              <span className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
                {result.ticket.customerId ? "customer linked" : "no customer match"}
              </span>
            </div>
            <h3 className="mt-4 text-sm font-medium">Summary</h3>
            <p className="text-sm">{result.ticket.summary}</p>
            <h3 className="mt-4 text-sm font-medium">Suggested response</h3>
            <p className="whitespace-pre-wrap text-sm">{result.ticket.suggestedResponse}</p>
          </section>

          <section className={cardClass}>
            <h2 className="text-lg font-semibold">What the agent did</h2>
            <ol className="mt-3 space-y-2">
              {result.toolCalls.map((call, i) => (
                <li key={i}>
                  <details className="rounded-md bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
                    <summary className="cursor-pointer font-mono">
                      {i + 1}. {call.name}
                    </summary>
                    <p className="mt-2 text-xs font-medium text-zinc-500">Arguments</p>
                    <pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(call.args, null, 2)}</pre>
                    <p className="mt-2 text-xs font-medium text-zinc-500">Result</p>
                    <pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(call.result, null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ol>
          </section>

          {result.finalText && (
            <section className={cardClass}>
              <h2 className="text-lg font-semibold">Agent response</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm">{result.finalText}</p>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
