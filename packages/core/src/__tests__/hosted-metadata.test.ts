import { test } from "node:test";
import assert from "node:assert/strict";
import { BlandIntegration, ElevenLabsIntegration, RetellIntegration, VapiIntegration,
  refreshHostedCall, MockLLMClient, type ProviderAccount, type TestResult } from "../index.js";

const account: ProviderAccount = { id: "account", provider: "bland", label: "Test", credentials: { apiKey: "test" }, createdAt: 0 };
const fetchFor = (responses: Record<string, unknown>): typeof fetch => (async (url: string | URL | Request) => {
  const key = String(url);
  if (!(key in responses)) throw new Error(`Unexpected request: ${key}`);
  return new Response(JSON.stringify(responses[key]), { headers: { "content-type": "application/json" } });
}) as typeof fetch;

test("Bland preserves full details and pathway events, including per-message node IDs", async () => {
  const call = new BlandIntegration(fetchFor({
    "https://api.bland.ai/v1/calls/call-1": { completed: true, metadata: { campaign: "test" }, pathway_id: "pathway-1",
      transcripts: [{ user: "assistant", text: "Hello" }] },
    "https://api.bland.ai/v1/pathway_calls/call-1?v=2": [
      { sequence: 1, event_type: "transcript.assistant", node_id: "greeting", payload: { text: "Hello" }, created_at: "2026-01-01T00:00:01Z" },
      { sequence: 2, event_type: "tool.invoke", node_id: "lookup", payload: { tool_name: "Lookup" }, created_at: "2026-01-01T00:00:02Z" },
      { sequence: 3, event_type: "transcript.user", node_id: "lookup", payload: { text: "Yes" }, created_at: "2026-01-01T00:00:03Z" },
    ],
  }));
  const state = await call.getCall(account, "call-1");
  assert.equal((state.details?.metadata as { campaign: string }).campaign, "test");
  assert.equal(state.events?.length, 3);
  assert.equal(state.transcript?.[0]?.meta?.nodeId, "greeting");
  assert.equal(state.transcript?.[1]?.meta?.nodeId, "lookup");
  assert.equal(state.trace?.[0]?.kind, "tool-call");
});

test("Bland keeps all call transcript turns when pathway events are delayed", async () => {
  const integration = new BlandIntegration(fetchFor({
    "https://api.bland.ai/v1/calls/call-2": { completed: true, transcripts: [
      { user: "assistant", text: "Hello" }, { user: "user", text: "I need help" },
    ] },
    "https://api.bland.ai/v1/pathway_calls/call-2?v=2": [
      { sequence: 1, event_type: "transcript.assistant", node_id: "greeting", payload: { text: "Hello" },
        created_at: "2026-01-01T00:00:01Z" },
    ],
  }));
  const state = await integration.getCall(account, "call-2");
  assert.equal(state.transcript?.length, 2);
  assert.equal(state.transcript?.[0]?.meta?.nodeId, "greeting");
  assert.equal(state.transcript?.[1]?.text, "I need help");
});

test("Vapi, Retell and ElevenLabs retain provider metadata and expose tool activity", async () => {
  const cases = [
    { provider: "vapi", integration: new VapiIntegration(fetchFor({ "https://api.vapi.ai/call/call-1": {
      status: "ended", analysis: { summary: "test" }, messages: [
        { role: "bot", message: "Hello" }, { role: "tool_calls", toolCallList: [{ name: "lookup" }] },
        { role: "tool", content: "found" }, { role: "user", message: "Thanks" },
      ],
    } })) },
    { provider: "retell", integration: new RetellIntegration(fetchFor({ "https://api.retellai.com/v2/get-call/call-1": {
      call_status: "ended", metadata: { test: true }, transcript_object: [{ role: "agent", content: "Hello" }, { role: "user", content: "Thanks" }],
      transcript_with_tool_calls: [{ role: "agent", content: "Hello" }, { role: "tool_call_invocation", name: "lookup" },
        { role: "tool_call_result", name: "lookup", content: "found" }],
    } })) },
    { provider: "elevenlabs", integration: new ElevenLabsIntegration(fetchFor({ "https://api.elevenlabs.io/v1/convai/conversations/call-1": {
      status: "done", metadata: { start_time_unix_secs: 1767225600, cost: 10 }, transcript: [
        { role: "agent", message: "Hello", time_in_call_secs: 0 },
        { role: "agent", message: null, time_in_call_secs: 1, tool_calls: [{ tool_name: "lookup" }] },
        { role: "agent", message: null, time_in_call_secs: 2, tool_results: [{ tool_name: "lookup", result_value: "found" }] },
        { role: "user", message: "Thanks", time_in_call_secs: 3 },
      ],
    } })) },
  ] as const;
  for (const { provider, integration } of cases) {
    const state = await integration.getCall({ ...account, provider }, "call-1");
    assert.equal(state.transcript?.length, 2, `${provider}: only speech is judged`);
    assert.equal(state.trace?.filter((event) => event.kind === "tool-call").length, 1, `${provider}: call`);
    assert.equal(state.trace?.filter((event) => event.kind === "tool-result").length, 1, `${provider}: result`);
    assert.ok(state.details && Object.keys(state.details).length > 2, `${provider}: complete response`);
  }
});

test("provider timestamps become recording offsets and recording requests use each provider's API", async () => {
  const requests: string[] = [];
  const fetchAudio = (async (url: string | URL | Request) => {
    requests.push(String(url));
    if (String(url).includes("get-call")) return new Response(JSON.stringify({ recording_url:
      "https://retellai.s3.us-west-2.amazonaws.com/call/recording.wav" }), { headers: { "content-type": "application/json" } });
    return new Response("audio", { headers: { "content-type": "audio/mpeg" } });
  }) as typeof fetch;
  const vapi = new VapiIntegration(fetchAudio);
  const retell = new RetellIntegration(fetchAudio);
  const eleven = new ElevenLabsIntegration(fetchAudio);
  await vapi.getRecording({ ...account, provider: "vapi" }, "call-1");
  await retell.getRecording({ ...account, provider: "retell" }, "call-1");
  await eleven.getRecording({ ...account, provider: "elevenlabs" }, "call-1");
  assert.deepEqual(requests, [
    "https://api.vapi.ai/call/call-1/mono-recording",
    "https://api.retellai.com/v2/get-call/call-1",
    "https://retellai.s3.us-west-2.amazonaws.com/call/recording.wav",
    "https://api.elevenlabs.io/v1/convai/conversations/call-1/audio",
  ]);
  const vapiTimed = new VapiIntegration(fetchFor({ "https://api.vapi.ai/call/call-1": { status: "ended",
    startedAt: "2026-01-01T00:00:00Z", messages: [{ role: "bot", message: "Hi", secondsFromStart: 1.25 }] } }));
  assert.equal((await vapiTimed.getCall({ ...account, provider: "vapi" }, "call-1")).transcript?.[0].audioStartMs, 1250);
  const retellTimed = new RetellIntegration(fetchFor({ "https://api.retellai.com/v2/get-call/call-1": { call_status: "ended",
    start_timestamp: 1767225600000, transcript_object: [{ role: "agent", content: "Hi", words: [{ start: 0.7 }] }] } }));
  assert.equal((await retellTimed.getCall({ ...account, provider: "retell" }, "call-1")).transcript?.[0].audioStartMs, 700);
  const elevenTimed = new ElevenLabsIntegration(fetchFor({ "https://api.elevenlabs.io/v1/convai/conversations/call-1": { status: "done",
    transcript: [{ role: "agent", message: "Hi", time_in_call_secs: 2.1 }] } }));
  assert.equal((await elevenTimed.getCall({ ...account, provider: "elevenlabs" }, "call-1")).transcript?.[0].audioStartMs, 2100);
});

test("refresh saves metadata on the dispatching side, including while the call is active", async () => {
  const integration = new VapiIntegration(fetchFor({ "https://api.vapi.ai/call/call-1": {
    status: "in-progress", metadata: { key: "value" }, messages: [{ role: "bot", message: "Hello" }],
  } }));
  const result: TestResult = { id: "run", testCaseId: "test", status: "running", startedAt: 0,
    transcript: [], liveChecks: [], externalCallId: "call-1" };
  const checked = await refreshHostedCall({ result, integration, account: { ...account, provider: "vapi" },
    judge: { rules: [] }, llm: new MockLLMClient(), providerAgentRole: "target" });
  assert.equal(checked.state, "in-progress");
  assert.equal(checked.result?.providerCalls?.targetAgent?.details.metadata &&
    (checked.result.providerCalls.targetAgent.details.metadata as { key: string }).key, "value");
  assert.equal(checked.result?.providerCalls?.testingAgent, undefined);
});

test("Bland only matches a distinct, unique inbound record for the same call window", async () => {
  const startedAt = Date.parse("2026-01-01T00:00:00Z");
  const url = "https://api.bland.ai/v1/calls?to_number=%2B14155550100&inbound=true&limit=100&start_date=2025-12-31T23%3A58%3A00.000Z&end_date=2026-01-01T00%3A02%3A00.000Z";
  const rows = [
    { call_id: "outbound", created_at: "2026-01-01T00:00:00Z", to: "+14155550100", from: "+14155550101" },
    { call_id: "inbound", created_at: "2026-01-01T00:00:02Z", to: "+14155550100", from: "+14155550101" },
    { call_id: "unrelated", created_at: "2026-01-01T01:00:00Z", to: "+14155550100", from: "+14155550101" },
  ];
  const input = { toNumber: "+14155550100", fromNumber: "+14155550101", startedAt, excludeCallId: "outbound" };
  assert.equal(await new BlandIntegration(fetchFor({ [url]: { calls: rows } })).findInboundCall(account, input), "inbound");
  assert.equal(await new BlandIntegration(fetchFor({ [url]: { calls: [...rows, { ...rows[1], call_id: "other" }] } })).findInboundCall(account, input), undefined);
});

test("Vapi, Retell and ElevenLabs only link a unique receiving agent call", async () => {
  const startedAt = Date.parse("2026-01-01T00:00:00Z");
  const input = { toNumber: "+14155550100", fromNumber: "+14155550101", startedAt,
    excludeCallId: "outbound", externalAgentId: "agent-1" };
  const fetchOne = (expectedPath: string, payload: unknown) => (async (url: string | URL | Request) => {
    assert.ok(String(url).startsWith(expectedPath));
    return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const vapi = new VapiIntegration(fetchOne("https://api.vapi.ai/call?", [
    { id: "inbound", type: "inboundPhoneCall", createdAt: "2026-01-01T00:00:02Z", assistantId: "agent-1",
      phoneNumber: { number: input.toNumber }, customer: { number: input.fromNumber } },
  ]));
  assert.equal(await vapi.findInboundCall({ ...account, provider: "vapi" }, input), "inbound");
  const retell = new RetellIntegration(fetchOne("https://api.retellai.com/v3/list-calls", { items: [
    { call_id: "inbound", call_type: "phone_call", direction: "inbound", start_timestamp: startedAt + 2000,
      agent_id: "agent-1", to_number: input.toNumber, from_number: input.fromNumber },
  ] }));
  assert.equal(await retell.findInboundCall({ ...account, provider: "retell" }, input), "inbound");
  const eleven = new ElevenLabsIntegration(fetchOne("https://api.elevenlabs.io/v1/convai/conversations?", { conversations: [
    { conversation_id: "inbound", direction: "inbound", start_time_unix_secs: startedAt / 1000 + 2, agent_id: "agent-1" },
  ] }));
  assert.equal(await eleven.findInboundCall({ ...account, provider: "elevenlabs" }, input), "inbound");
});
