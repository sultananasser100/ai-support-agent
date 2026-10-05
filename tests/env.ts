// Must be the first import of every test file. It runs before src/lib/db.ts is
// loaded, forces a fake Gemini key (the real one is never used in tests), and
// makes any accidental network call fail.
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/ai_support_agent";
process.env.GEMINI_API_KEY = "test-key-not-used";
process.env.GEMINI_MODEL = "gemini-3.8-flash";

globalThis.fetch = (() => {
  throw new Error("Network access is blocked in tests");
}) as typeof fetch;
