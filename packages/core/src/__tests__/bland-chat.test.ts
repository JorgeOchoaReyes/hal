import { test } from "node:test";
import assert from "node:assert/strict";
import { BlandChatTransport } from "../transport/bland-chat.js";

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

test("Bland chat rejects HTTP and application errors without exposing provider content", async () => {
  for (const response of [new Response("fixture-secret", { status: 401 }), Response.json({ errors: ["fixture-secret"], data: {} })]) {
    const transport = new BlandChatTransport("secret", (async () => response) as typeof fetch);
    await assert.rejects(transport.connect({ name: "Target", transport: "bland-chat", pathwayId: "path1" }), (err: Error) => { assert(!err.message.includes("fixture-secret")); return true; });
  }
});
