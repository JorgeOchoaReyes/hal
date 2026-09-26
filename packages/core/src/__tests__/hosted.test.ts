import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VapiIntegration,
  ElevenLabsIntegration,
  RetellIntegration,
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

test("Bland maps the alternate speaker:ai/human transcript shape to agent/target", async () => {
  const bland = new BlandIntegration(
    fakeFetch({
      "GET https://api.bland.ai/v1/calls/c1": {
        completed: true,
        transcripts: [
          { speaker: "ai", text: "Hi, I'm testing your line." },
          { speaker: "human", text: "Okay, go ahead." },
        ],
      },
    }),
  );
  const acc: ProviderAccount = { ...account, provider: "bland", credentials: { apiKey: "bk" } };
  const state = await bland.getCall(acc, "c1");
  // The AI (Bland's own agent = our tester) must be `agent`; the human (target
  // under test) must be `target` — otherwise the judge sees only one side.
  assert.equal(state.transcript?.[0]?.role, "agent");
  assert.equal(state.transcript?.[1]?.role, "target");
});

test("Bland verifyCredentials only fails on an explicit 401/403", async () => {
  const acc: ProviderAccount = { ...account, provider: "bland", credentials: { apiKey: "bk" } };
  // A 404 on the probe endpoint must NOT be reported as an invalid key.
  const notFound = new BlandIntegration((async () =>
    new Response("nope", { status: 404 })) as unknown as typeof fetch);
  assert.equal((await notFound.verifyCredentials(acc)).ok, true);
  // A 401 is a real auth failure.
  const unauth = new BlandIntegration((async () =>
    new Response("bad key", { status: 401 })) as unknown as typeof fetch);
  assert.equal((await unauth.verifyCredentials(acc)).ok, false);
});

test("Bland uses a supplied pathwayId directly (no create call) and calls with it", async () => {
  const reqs: { url: string; body: Record<string, unknown> }[] = [];
  const capture = (async (url: string | URL, init?: RequestInit) => {
    reqs.push({ url: url.toString(), body: init?.body ? JSON.parse(String(init.body)) : {} });
    return new Response(JSON.stringify({ call_id: "c9" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const bland = new BlandIntegration(capture);
  const acc: ProviderAccount = { ...account, provider: "bland", credentials: { apiKey: "bk" } };
  const spec = { name: "T", persona: { name: "T", systemPrompt: "x" }, pathwayId: "pw_existing" };

  const { externalAgentId } = await bland.createTestingAgent(acc, spec);
  assert.equal(externalAgentId, "pw_existing");
  // No pathway-create request is made when an id is supplied.
  assert.ok(!reqs.some((r) => r.url.includes("/v1/pathway")));

  const agent: HostedTestingAgent = {
    id: "a", accountId: acc.id, provider: "bland", externalAgentId, name: "T", createdAt: 0, spec,
  };
  await bland.placeCall(acc, agent, { phoneNumber: "+14155550123" });
  const call = reqs.find((r) => r.url.endsWith("/v1/calls"))!;
  assert.equal((call.body as { pathway_id: string }).pathway_id, "pw_existing");
});

test("Bland listRemoteAgents normalizes pathway rows from any envelope", async () => {
  const acc: ProviderAccount = { ...account, provider: "bland", credentials: { apiKey: "bk" } };
  // Bare array.
  const arr = new BlandIntegration(fakeFetch({
    "GET https://api.bland.ai/v1/pathway": [
      { id: "pw1", name: "Booking" },
      { pathway_id: "pw2", name: "Support" },
      { name: "no id — skipped" },
    ],
  }));
  const list = await arr.listRemoteAgents(acc);
  assert.deepEqual(list, [
    { id: "pw1", name: "Booking", kind: "pathway" },
    { id: "pw2", name: "Support", kind: "pathway" },
  ]);
  // `data`-wrapped single object.
  const wrapped = new BlandIntegration(fakeFetch({
    "GET https://api.bland.ai/v1/pathway": { data: { id: "pw9", name: "Solo" } },
  }));
  assert.deepEqual(await wrapped.listRemoteAgents(acc), [{ id: "pw9", name: "Solo", kind: "pathway" }]);
});

test("Vapi/Retell/ElevenLabs listRemoteAgents let My agents import a real agent", async () => {
  const vapi = new VapiIntegration(fakeFetch({
    "GET https://api.vapi.ai/assistant": [
      { id: "a1", name: "Support Assistant" },
      { id: "a2" },
    ],
  }));
  assert.deepEqual(await vapi.listRemoteAgents(account), [
    { id: "a1", name: "Support Assistant", kind: "agent" },
    { id: "a2", name: "a2", kind: "agent" },
  ]);

  const retell = new RetellIntegration(fakeFetch({
    "GET https://api.retellai.com/list-agents": [
      { agent_id: "r1", agent_name: "Booking Agent" },
      { agent_name: "no id — skipped" },
    ],
  }));
  assert.deepEqual(await retell.listRemoteAgents(account), [
    { id: "r1", name: "Booking Agent", kind: "agent" },
  ]);

  // ElevenLabs wraps rows under `agents`.
  const el = new ElevenLabsIntegration(fakeFetch({
    "GET https://api.elevenlabs.io/v1/convai/agents": {
      agents: [{ agent_id: "e1", name: "Front Desk" }],
    },
  }));
  assert.deepEqual(await el.listRemoteAgents(account), [{ id: "e1", name: "Front Desk", kind: "agent" }]);
});

test("Bland sends a Bearer Authorization header", async () => {
  let auth = "";
  const capture = (async (_url: string | URL, init?: RequestInit) => {
    auth = String((init?.headers as Record<string, string>)?.authorization ?? "");
    return new Response(JSON.stringify({ completed: true, transcripts: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const bland = new BlandIntegration(capture);
  const acc: ProviderAccount = { ...account, provider: "bland", credentials: { apiKey: "bk" } };
  await bland.getCall(acc, "c1");
  assert.equal(auth, "Bearer bk");
});

test("each platform compiles a structured test into its own native agent config", () => {
  const structured = {
    role: "You are a patient booking an appointment",
    conditions: [
      { id: 0, condition: "FIRST_MESSAGE", action: "Hi, I'd like to book.", type: "standard" as const, fixed_message: true },
      { id: 1, condition: "The agent asks the day", action: "Say Tuesday", type: "standard" as const, fixed_message: false },
    ],
  };
  const spec = {
    name: "Booker",
    persona: { name: "Booker", systemPrompt: "unused when structured" },
    structured,
  };

  const vapi = new VapiIntegration().buildAgentConfig(spec) as {
    firstMessage: string;
    model: { messages: Array<{ content: string }> };
  };
  assert.equal(vapi.firstMessage, "Hi, I'd like to book.");
  assert.ok(vapi.model.messages[0]!.content.includes("ROLE: You are a patient booking"));
  assert.ok(vapi.model.messages[0]!.content.includes("when The agent asks the day"));

  const el = new ElevenLabsIntegration().buildAgentConfig(spec) as {
    conversation_config: { agent: { prompt: { prompt: string }; first_message: string } };
  };
  assert.equal(el.conversation_config.agent.first_message, "Hi, I'd like to book.");
  assert.ok(el.conversation_config.agent.prompt.prompt.includes("Open the call"));

  const bland = new BlandIntegration().buildAgentConfig(spec) as {
    prompt: string;
    first_sentence: string;
    metadata: { hal_steps: unknown[] };
  };
  assert.equal(bland.first_sentence, "Hi, I'd like to book.");
  assert.equal(bland.metadata.hal_steps.length, 2);
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

test("Bland validates caller ID and explains ownership errors without leaking credentials", async () => {
  const requests: Array<{ body: any; headers: any }> = [];
  const bland = new BlandIntegration((async (_url, init) => {
    requests.push({ body: JSON.parse(String(init?.body)), headers: init?.headers });
    return new Response(JSON.stringify({ message: "Invalid 'from' - you might not own this number. Did you specify a country code?" }), { status: 400 });
  }) as typeof fetch);
  const acc = { ...account, provider: "bland", label: "QA account", credentials: { apiKey: "secret-api", from: "+14155550111", encryptedKey: "secret-byot" } };
  const agent = { id: "a", accountId: acc.id, provider: "bland", externalAgentId: "pw", name: "T", createdAt: 0 };
  await assert.rejects(bland.placeCall(acc, agent, { phoneNumber: "+14155550222" }), (err: Error) => {
    assert.match(err.message, /outbound caller ID.*14155550111/);
    assert.match(err.message, /provider account’s From number/);
    assert.match(err.message, /QA account/);
    assert.match(err.message, /BYOT/);
    assert.ok(!err.message.includes("secret-api") && !err.message.includes("secret-byot"));
    return true;
  });
  assert.equal(requests[0].headers.encrypted_key, "secret-byot");
  assert.equal(requests[0].body.encrypted_key, undefined);
  await assert.rejects(bland.placeCall(acc, agent, { phoneNumber: "+14155550222", fromNumber: "4155550111" }), /country code/);
  assert.equal(requests.length, 1, "invalid format must not place a call");
  await assert.rejects(bland.placeCall(acc, agent, { phoneNumber: "+14155550222", fromNumber: "" }));
  assert.equal(requests[1].body.from, undefined, "explicit pool must override account default");
  await assert.rejects(bland.placeOutboundCall(acc, { externalAgentId: "pw", encryptedKey: "agent-byot" }, { phoneNumber: "+14155550222", fromNumber: "+1 (415) 555-0333" }));
  assert.equal(requests[2].headers.encrypted_key, "agent-byot");
  assert.equal(requests[2].body.encrypted_key, undefined);
  assert.equal(requests[2].body.from, "+14155550333");
});

test("Bland binds a structured tester to its inbound number and stops on rejection", async () => {
  const requests: Array<{ url: string; body: any }> = [];
  const bland = new BlandIntegration((async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ status: requests.length === 1 ? "success" : "error" }), { status: 200 });
  }) as typeof fetch);
  const agent = { id: "a", accountId: account.id, provider: "bland", externalAgentId: "new-pathway", name: "T", createdAt: 0,
    spec: { name: "T", persona: { name: "T", systemPrompt: "test" }, pathwayId: "new-pathway" } };
  await bland.configureInbound(account, agent, "+14155550123");
  assert.equal(requests[0].url, "https://api.bland.ai/v1/inbound/%2B14155550123");
  assert.equal(requests[0].body.pathway_id, "new-pathway");
  await assert.rejects(bland.configureInbound(account, agent, "+14155550123"), /No call was placed/);
});

function runnerOptions(getCall: () => Promise<HostedCallState>) {
  return {
    testCaseId: "tc", account,
    agent: { id: "a", accountId: account.id, provider: "fake", externalAgentId: "x", name: "T", createdAt: 0 },
    target: { phoneNumber: "+14155550123" },
    judge: { mode: "rules-only" as const, rules: [{ kind: "regex" as const, pattern: "booked", role: "target" as const }] },
    llm: new MockLLMClient(), pollIntervalMs: 1,
    integration: { id: "fake", label: "Fake", credentialFields: [],
      buildAgentConfig: () => ({}), buildFlowConfig: () => null,
      verifyCredentials: async () => ({ ok: true }),
      createTestingAgent: async () => ({ externalAgentId: "x" }),
      placeCall: async () => ({ externalCallId: "c" }), getCall },
  };
}

test("outbound target roles are normalized before role-scoped judging", async () => {
  const opts = runnerOptions(async () => ({ externalCallId: "c", status: "ended", transcript: [
    { role: "agent", text: "booked", startedAt: 0 },
    { role: "target", text: "thanks", startedAt: 1 },
    { role: "system", text: "ended", startedAt: 2 },
  ] }));
  const result = await runHostedCall({ ...opts, providerAgentRole: "target" });
  assert.equal(result.status, "passed");
  assert.deepEqual(result.transcript.map((t) => t.role), ["target", "agent", "system"]);
  assert.equal((await runHostedCall(opts)).status, "failed");
});

test("timeouts never judge partial transcripts as passed", async () => {
  const result = await runHostedCall({ ...runnerOptions(async () => ({ externalCallId: "c", status: "in-progress", transcript: [{ role: "target", text: "booked", startedAt: 0 }] })), timeoutMs: 10 });
  assert.equal(result.status, "errored");
  assert.match(result.error!, /Timed out/);
  assert.equal(result.verdict, undefined);
  assert.equal(result.externalCallId, "c");
  assert.equal(result.transcript.length, 1);
});

test("poll failures preserve transcript and provider failure reasons", async () => {
  let calls = 0;
  const result = await runHostedCall(runnerOptions(async () => {
    if (++calls > 1) throw new Error("provider unavailable");
    return { externalCallId: "c", status: "in-progress", transcript: [{ role: "target", text: "hello", startedAt: 0 }] };
  }));
  assert.equal(result.transcript.length, 1);
  assert.match(result.error!, /provider unavailable/);
  const failed = await runHostedCall(runnerOptions(async () => ({ externalCallId: "c", status: "failed", endedReason: "number busy" })));
  assert.equal(failed.error, "number busy");
  const empty = await runHostedCall(runnerOptions(async () => ({ externalCallId: "c", status: "ended" })));
  assert.equal(empty.status, "errored");
});
