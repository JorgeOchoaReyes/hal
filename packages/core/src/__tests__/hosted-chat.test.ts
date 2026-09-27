import { test } from "node:test";
import assert from "node:assert/strict";
import { HostedChatTransport } from "../transport/hosted-chat.js";

test("Vapi chat uses a session bound to the selected assistant or squad", async () => {
  for (const resourceKind of ["assistant", "squad"] as const) {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url: String(url), body });
      return Response.json(calls.length === 1 ? { id: "session1" } : { output: [{ role: "assistant", content: [{ type: "output_text", text: "How can I help?" }] }] });
    };
    const session = await new HostedChatTransport("test-key", fetchImpl as typeof fetch).connect({ transport: "hosted-chat", name: "Main", provider: "vapi", externalAgentId: "main1", resourceKind });
    await session.speak("Hi");
    assert.equal((await session.listen())?.text, "How can I help?");
    assert.equal(calls[0]?.body[resourceKind === "squad" ? "squadId" : "assistantId"], "main1");
    assert.equal(calls[1]?.body.sessionId, "session1");
  }
});

test("Retell chat creates a conversation and returns the selected agent's reply", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return Response.json(calls.length === 1 ? { chat_id: "chat1" } : { messages: [{ role: "agent", content: "Welcome" }] });
  };
  const session = await new HostedChatTransport("test-key", fetchImpl as typeof fetch).connect({ transport: "hosted-chat", name: "Main", provider: "retell", externalAgentId: "agent1" });
  await session.speak("Hello");
  assert.equal((await session.listen())?.text, "Welcome");
  assert.equal(calls[0]?.body.agent_id, "agent1");
  assert.equal(calls[1]?.body.chat_id, "chat1");
});
