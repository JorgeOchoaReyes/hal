import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VapiIntegration,
  ElevenLabsIntegration,
  BlandIntegration,
  runHostedCall,
  MockLLMClient,
  getIntegration,
  type ProviderAccount,
  type HostedTestingAgent,
  type VoiceProviderIntegration,
  type HostedCallState,
} from "../index.js";

/** A fake fetch that dispatches by URL + method to canned JSON responses. */
function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${u}`;
    const match = Object.keys(routes).find((k) => key.startsWith(k));
    if (!match) throw new Error(`no fake route for ${key}`);
    return new Response(JSON.stringify(routes[match]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

const account: ProviderAccount = {
  id: "acc1",
  provider: "vapi",
  label: "My Vapi",
  credentials: { apiKey: "sk-test", phoneNumberId: "pn-1" },
  createdAt: 0,
};

test("Vapi integration creates an assistant, places a call, and parses transcript", async () => {
  const fetchImpl = fakeFetch({
    "POST https://api.vapi.ai/assistant": { id: "asst_123" },
    "POST https://api.vapi.ai/call": { id: "call_456" },
    "GET https://api.vapi.ai/call/call_456": {
      status: "ended",
      messages: [
        { role: "bot", message: "Hi, I'm calling to test you." },
        { role: "user", message: "Sure, how can I help?" },
      ],
    },
  });
  const vapi = new VapiIntegration(fetchImpl);

  const { externalAgentId } = await vapi.createTestingAgent(account, {
    name: "Tester",
    persona: { name: "Tester", systemPrompt: "You test voice agents." },
  });
  assert.equal(externalAgentId, "asst_123");

  const agent: HostedTestingAgent = {
    id: "a1",
    accountId: account.id,
    provider: "vapi",
    externalAgentId,
    name: "Tester",
    createdAt: 0,
  };
  const { externalCallId } = await vapi.placeCall(account, agent, { phoneNumber: "+14155550123" });
  assert.equal(externalCallId, "call_456");

  const state = await vapi.getCall(account, externalCallId);
  assert.equal(state.status, "ended");
  assert.equal(state.transcript?.length, 2);
  // The Vapi "bot" is our tester agent; "user" is the target under test.
  assert.equal(state.transcript?.[0]?.role, "agent");
  assert.equal(state.transcript?.[1]?.role, "target");
});

test("ElevenLabs integration maps roles and status", async () => {
  const el = new ElevenLabsIntegration(
    fakeFetch({
      "POST https://api.elevenlabs.io/v1/convai/agents/create": { agent_id: "agent_9" },
      "POST https://api.elevenlabs.io/v1/convai/twilio/outbound-call": { conversation_id: "conv_9" },
      "GET https://api.elevenlabs.io/v1/convai/conversations/conv_9": {
        status: "done",
        transcript: [
          { role: "agent", message: "Hello there." },
          { role: "user", message: "Hi." },
        ],
      },
    }),
  );
  const acc: ProviderAccount = { ...account, provider: "elevenlabs" };
  const { externalAgentId } = await el.createTestingAgent(acc, {
    name: "T",
    persona: { name: "T", systemPrompt: "test" },
  });
  assert.equal(externalAgentId, "agent_9");
  const state = await el.getCall(acc, "conv_9");
  assert.equal(state.status, "ended");
  assert.equal(state.transcript?.[0]?.role, "agent");
  assert.equal(state.transcript?.[1]?.role, "target");
});

test("Bland integration creates an agent, places a task call, and maps transcript", async () => {
  const bland = new BlandIntegration(
    fakeFetch({
      "POST https://api.bland.ai/v1/agents": { agent: { agent_id: "bland_agent_1" } },
      "POST https://api.bland.ai/v1/calls": { call_id: "bland_call_1" },
      "GET https://api.bland.ai/v1/calls/bland_call_1": {
        completed: true,
        transcripts: [
          { user: "assistant", text: "Hi, I'm testing your line." },
          { user: "user", text: "Okay, go ahead." },
        ],
      },
    }),
  );
  const acc: ProviderAccount = { ...account, provider: "bland", credentials: { apiKey: "bk" } };
  const { externalAgentId } = await bland.createTestingAgent(acc, {
    name: "T",
    persona: { name: "T", systemPrompt: "You test voice agents." },
  });
  assert.equal(externalAgentId, "bland_agent_1");

  const agent: HostedTestingAgent = {
    id: "a",
    accountId: acc.id,
    provider: "bland",
    externalAgentId,
    name: "T",
    createdAt: 0,
    spec: { name: "T", persona: { name: "T", systemPrompt: "You test voice agents." } },
  };
  const { externalCallId } = await bland.placeCall(acc, agent, { phoneNumber: "+14155550123" });
  assert.equal(externalCallId, "bland_call_1");

  const state = await bland.getCall(acc, externalCallId);
  assert.equal(state.status, "ended");
  assert.equal(state.transcript?.[0]?.role, "agent");
  assert.equal(state.transcript?.[1]?.role, "target");
});

test("built-in integrations are registered", () => {
  assert.ok(getIntegration("vapi"));
  assert.ok(getIntegration("elevenlabs"));
  assert.ok(getIntegration("bland"));
  assert.equal(getIntegration("nope"), undefined);
});

test("runHostedCall polls to completion then judges the transcript", async () => {
  // A fake integration that returns 'queued' once, then 'ended' with a transcript.
  let polls = 0;
  const integration: VoiceProviderIntegration = {
    id: "fake",
    label: "Fake",
    credentialFields: [],
    async createTestingAgent() {
      return { externalAgentId: "x" };
    },
    async placeCall() {
      return { externalCallId: "c1" };
    },
    async getCall(): Promise<HostedCallState> {
      polls++;
      if (polls < 2) return { externalCallId: "c1", status: "in-progress" };
      return {
        externalCallId: "c1",
        status: "ended",
        transcript: [
          { role: "agent", text: "Testing.", startedAt: 0 },
          { role: "target", text: "I booked your appointment.", startedAt: 1 },
        ],
      };
    },
  };

  const result = await runHostedCall({
    testCaseId: "tc1",
    integration,
    account: { ...account, provider: "fake" },
    agent: { id: "a", accountId: "acc1", provider: "fake", externalAgentId: "x", name: "t", createdAt: 0 },
    target: { phoneNumber: "+14155550123" },
    judge: { mode: "rules-only", rules: [{ kind: "min-turns", count: 2 }] },
    llm: new MockLLMClient(),
    pollIntervalMs: 1,
    timeoutMs: 5000,
  });

  assert.ok(polls >= 2, "should poll until ended");
  assert.equal(result.status, "passed");
  assert.equal(result.transcript.length, 2);
  assert.ok(result.metrics, "metrics computed");
  assert.equal(result.externalCallId, "c1");
});
