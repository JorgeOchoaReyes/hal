import { test } from "node:test";
import assert from "node:assert/strict";
import { GeminiClient, createLLM } from "../index.js";

/** Capture the outgoing request and return a canned Gemini response. */
function capturing(text: string): { fetch: typeof fetch; last: () => { url: string; body: unknown } } {
  let captured: { url: string; body: unknown } = { url: "", body: undefined };
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: url.toString(), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetch: f, last: () => captured };
}

test("GeminiClient maps roles, system instruction, and JSON mode", async () => {
  const { fetch, last } = capturing('{"ok":true}');
  const client = new GeminiClient({ apiKey: "k", defaultModel: "gemini-1.5-flash" });
  // The client uses global fetch; swap it for the capturing stub.
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const out = await client.complete({
      messages: [
        { role: "system", content: "You are a judge." },
        { role: "user", content: "Score this." },
        { role: "assistant", content: "prior" },
      ],
      json: true,
    });
    assert.equal(out, '{"ok":true}');
    const body = last().body as {
      systemInstruction?: { parts: Array<{ text: string }> };
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      generationConfig: { responseMimeType?: string };
    };
    assert.equal(body.systemInstruction?.parts[0].text, "You are a judge.");
    assert.deepEqual(
      body.contents.map((c) => c.role),
      ["user", "model"],
    );
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.match(last().url, /models\/gemini-1\.5-flash:generateContent/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("createLLM('gemini') returns a Gemini client", () => {
  const c = createLLM("gemini");
  assert.equal(c.name, "gemini");
});
