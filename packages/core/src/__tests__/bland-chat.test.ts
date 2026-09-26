import { test } from "node:test";
import assert from "node:assert/strict";
import { BlandChatTransport } from "../transport/bland-chat.js";
import { TestRunner } from "../runner/runner.js";
import { MockLLMClient } from "../llm/mock.js";
import type { TestCase } from "../types.js";

test("Bland chat creates a pathway session, captures opening/replies, and never phones", async () => {
  const requests: Array<{ url: string; body: any }> = [];
  const transport = new BlandChatTransport("fixture-key", (async (url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push({ url: String(url), body });
    assert.equal((init?.headers as any).authorization, "Bearer fixture-key");
    if (String(url).endsWith("/create")) return Response.json({ data: { chat_id: "chat1" }, errors: null });
    return Response.json({ data: { assistant_responses: body.message ? ["All set.", "Goodbye."] : ["How can I help?"], completed: Boolean(body.message) }, errors: null });
  }) as typeof fetch);
  const session = await transport.connect({ name: "Target", transport: "bland-chat", pathwayId: "path1" });
  assert.equal(session.externalId, "chat1");
  assert.deepEqual(requests[0].body, { pathway_id: "path1" });
  assert.equal((await session.listen())?.text, "How can I help?");
  assert.equal(await session.listen(), null);
  await session.speak("Please help");
  assert.equal((await session.listen())?.text, "All set.\nGoodbye.");
  assert.equal(requests[2].body.message, "Please help");
  await assert.rejects(session.speak("More"), /ended the chat/);
  assert(requests.every((r) => r.url.startsWith("https://us.api.bland.ai/v1/pathway/chat/")));
});

function chatCase(): TestCase {
  return {
    id: "chat-test", name: "Booking chat",
    target: { transport: "bland-chat", name: "Target", pathwayId: "path1" },
    scenario: {
      id: "booking", name: "Booking",
      persona: { name: "Tester", systemPrompt: "Book an appointment" },
      steps: [
        { kind: "say", text: "Book Tuesday" },
        { kind: "expect", assertion: { id: "confirmed", description: "Booking confirmed", matches: "confirmed", fatal: true } },
        { kind: "say", text: "Thank you" },
        { kind: "hangup" },
      ],
    },
    judge: { mode: "rules-only", rules: [{ kind: "transcript-contains", needle: "confirmed" }] },
  };
}

test("Bland completion preserves the transcript, chat ID and final assertions before judging", async () => {
  for (const completedOnGreeting of [false, true]) {
    const messages: string[] = [];
    const transport = new BlandChatTransport("fixture", (async (url, init) => {
      if (String(url).endsWith("/create")) return Response.json({ data: { chat_id: "chat1" } });
      const { message } = JSON.parse(String(init?.body));
      if (message) messages.push(message);
      return Response.json({ data: {
        assistant_responses: [message || completedOnGreeting ? "Booking confirmed. Goodbye." : "How can I help?"],
        completed: completedOnGreeting || Boolean(message),
      } });
    }) as typeof fetch);
    const tc = chatCase();
    if (completedOnGreeting) tc.scenario.steps.shift();
    const result = await new TestRunner({ llm: new MockLLMClient(), resolveTransport: () => transport }).run(tc).result;
    assert.equal(result.status, "passed");
    assert.equal(result.externalCallId, "chat1");
    assert.equal(result.transcript.length, completedOnGreeting ? 1 : 3);
    assert.equal(result.transcript.at(-1)?.text, "Booking confirmed. Goodbye.");
    assert.equal(result.verdict?.passed, true);
    assert.equal(result.liveChecks[0]?.passed, true);
    assert.deepEqual(messages, completedOnGreeting ? [] : ["Book Tuesday"]);
  }
});

test("Bland completion still fails a fatal assertion on its final response", async () => {
  const transport = new BlandChatTransport("fixture", (async (url) => Response.json({ data:
    String(url).endsWith("/create") ? { chat_id: "chat1" } : { assistant_responses: ["No appointments. Goodbye."], completed: true },
  })) as typeof fetch);
  const tc = chatCase();
  tc.scenario.steps.shift();
  const result = await new TestRunner({ llm: new MockLLMClient(), resolveTransport: () => transport }).run(tc).result;
  assert.equal(result.status, "failed");
  assert.equal(result.liveChecks[0]?.passed, false);
  assert.equal(result.transcript.length, 1);
  assert.equal(result.externalCallId, "chat1");
});

test("Bland request failures preserve the conversation already recorded", async () => {
  const transport = new BlandChatTransport("fixture", (async (url, init) => {
    if (String(url).endsWith("/create")) return Response.json({ data: { chat_id: "chat1" } });
    const { message } = JSON.parse(String(init?.body));
    if (message === "Thank you") return new Response("provider error", { status: 503 });
    return Response.json({ data: { assistant_responses: [message ? "Booking confirmed." : "Hello"], completed: false } });
  }) as typeof fetch);
  const result = await new TestRunner({ llm: new MockLLMClient(), resolveTransport: () => transport }).run(chatCase()).result;
  assert.equal(result.status, "errored");
  assert.match(result.error!, /HTTP 503/);
  assert.equal(result.externalCallId, "chat1");
  assert.equal(result.transcript.length, 3);
  assert.equal(result.liveChecks[0]?.passed, true);
  assert.equal(result.verdict, undefined);
});

test("Bland chat rejects HTTP and application errors without exposing provider content", async () => {
  for (const response of [new Response("fixture-secret", { status: 401 }), Response.json({ errors: ["fixture-secret"], data: {} })]) {
    const transport = new BlandChatTransport("secret", (async () => response) as typeof fetch);
    await assert.rejects(transport.connect({ name: "Target", transport: "bland-chat", pathwayId: "path1" }), (err: Error) => { assert(!err.message.includes("fixture-secret")); return true; });
  }
});
