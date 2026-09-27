import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VapiIntegration,
  BlandIntegration,
  RetellIntegration,
  ElevenLabsIntegration,
  type ProviderAccount,
  type HostedTestingAgent,
  type StructuredTest,
  type TestingAgentSpec,
} from "../index.js";

const structured: StructuredTest = {
  role: "You are a patient booking",
  conditions: [
    { id: 0, condition: "FIRST_MESSAGE", action: "Hi, book me.", type: "standard", fixed_message: true },
    { id: 1, condition: "asks day", action: "Say Tuesday", type: "standard", fixed_message: false },
  ],
};
const spec: TestingAgentSpec = { name: "Booker", persona: { name: "Booker", systemPrompt: "x" }, structured };

interface Captured {
  url: string;
  method: string;
  body: unknown;
}

/** Fake fetch that records each request and returns canned bodies by route. */
function capturing(routes: Record<string, unknown>): { fetch: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = url.toString();
    calls.push({ url: u, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find((k) => u.endsWith(k));
    return new Response(JSON.stringify(key ? routes[key] : {}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

const account: ProviderAccount = { id: "a", provider: "x", label: "L", credentials: { apiKey: "k", phoneNumberId: "pn", from: "+14155550111" }, createdAt: 0 };
const agentFrom = (id: string): HostedTestingAgent => ({
  id: "h", accountId: "a", provider: "x", externalAgentId: id, name: "n", createdAt: 0, spec,
});

test("Bland provisions a Pathway (create + set graph) and calls with pathway_id", async () => {
  const { fetch, calls } = capturing({
    "/v1/pathway/create": { pathway_id: "pw1" },
    "/v1/calls": { call_id: "c1" },
  });
  const bland = new BlandIntegration(fetch);
  const { externalAgentId } = await bland.createTestingAgent(account, spec);
  assert.equal(externalAgentId, "pw1");
  // Creates the pathway shell, then sets its nodes/edges on the returned id.
  assert.ok(calls.some((c) => c.url.endsWith("/v1/pathway/create")));
  const graphCall = calls.find((c) => c.url.endsWith("/v1/pathway/pw1"));
  assert.ok(graphCall, "sets the node graph on the created pathway");
  assert.ok(Array.isArray((graphCall!.body as { nodes: unknown[] }).nodes));

  await bland.placeCall(account, agentFrom("pw1"), { phoneNumber: "+14155550123" });
  const call = calls.find((c) => c.url.endsWith("/v1/calls"))!;
  assert.equal((call.body as { pathway_id: string }).pathway_id, "pw1");
});

test("Bland versions and publishes the pathway when the version endpoint returns an id", async () => {
  const { fetch, calls } = capturing({
    "/v1/pathway/create": { pathway_id: "pw1" },
    "/v1/pathway/pw1/version": { version_number: 3 },
  });
  const bland = new BlandIntegration(fetch);
  await bland.createTestingAgent(account, spec);
  // Documented lifecycle: create → set graph → create version → publish it.
  assert.ok(calls.some((c) => c.url.endsWith("/v1/pathway/pw1/version")));
  const publish = calls.find((c) => c.url.endsWith("/v1/pathway/pw1/publish"));
  assert.ok(publish, "promotes the created version");
  assert.equal((publish!.body as { version_id: number }).version_id, 3);
  assert.equal((publish!.body as { environment: string }).environment, "production");
});

test("Vapi provisions a Squad and calls with squadId", async () => {
  const { fetch, calls } = capturing({ "/squad": { id: "sq1" }, "/call": { id: "c1" } });
  const vapi = new VapiIntegration(fetch);
  const { externalAgentId } = await vapi.createTestingAgent(account, spec);
  assert.equal(externalAgentId, "sq1");
  assert.ok(calls.some((c) => c.url.endsWith("/squad")));

  await vapi.placeCall(account, { ...agentFrom("sq1"), spec: { ...spec, graphKind: "squad" } }, { phoneNumber: "+14155550123" });
  const call = calls.find((c) => c.url.endsWith("/call"))!;
  assert.equal((call.body as { squadId: string }).squadId, "sq1");
});

test("Retell provisions a Conversation Flow and binds the agent to it", async () => {
  const { fetch, calls } = capturing({
    "/create-conversation-flow": { conversation_flow_id: "cf1" },
    "/create-agent": { agent_id: "ag1" },
  });
  const retell = new RetellIntegration(fetch);
  const { externalAgentId } = await retell.createTestingAgent(account, spec);
  assert.equal(externalAgentId, "ag1");
  assert.ok(calls.some((c) => c.url.endsWith("/create-conversation-flow")));
  const agentCall = calls.find((c) => c.url.endsWith("/create-agent"))!;
  const re = (agentCall.body as { response_engine: { type: string; conversation_flow_id: string } }).response_engine;
  assert.equal(re.type, "conversation-flow");
  assert.equal(re.conversation_flow_id, "cf1");
});

test("ElevenLabs embeds the workflow graph in the agent config", () => {
  const cfg = new ElevenLabsIntegration().buildAgentConfig(spec) as {
    workflow: { nodes: Record<string, unknown> };
    conversation_config: { agent: { workflow?: unknown } };
  };
  assert.ok(cfg.workflow, "workflow at the API's top level");
  assert.ok(Object.keys(cfg.workflow.nodes).length >= 2);
  assert.equal(cfg.conversation_config.agent.workflow, undefined);
});

test("Vapi converts an imported tester to a reusable squad, then patches that squad", async () => {
  const { fetch, calls } = capturing({ "/squad": { id: "sq1" }, "/squad/sq1": { id: "sq1" }, "/call": { id: "c1" } });
  const vapi = new VapiIntegration(fetch);
  const scripted = { ...spec, structured: undefined, steps: [{ kind: "say" as const, text: "Hello" }, { kind: "hangup" as const }] };
  const first = await vapi.updateTestingAgent(account, { ...agentFrom("assistant1"), imported: true, spec: undefined }, scripted);
  assert.equal(first.externalAgentId, "sq1");
  const saved = { ...agentFrom("sq1"), spec: { ...scripted, graphKind: "squad" as const } };
  const second = await vapi.updateTestingAgent(account, saved, scripted);
  assert.equal(second.externalAgentId, "sq1");
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[1]!.method, "PATCH");
  await vapi.placeCall(account, saved, { phoneNumber: "+14155550123" });
  assert.equal((calls[2]!.body as { squadId: string }).squadId, "sq1");
});

test("Retell creates a flow, versions the selected agent, binds and publishes it", async () => {
  const { fetch, calls } = capturing({
    "/create-conversation-flow": { conversation_flow_id: "flow1" },
    "/get-agent/agent1": { version: 2, is_published: true },
    "/create-agent-version/agent1": { version: 3 },
  });
  const retell = new RetellIntegration(fetch);
  const scripted = { ...spec, structured: undefined, steps: [{ kind: "say" as const, text: "Hello" }, { kind: "hangup" as const }] };
  await retell.updateTestingAgent(account, agentFrom("agent1"), scripted);
  assert.deepEqual(calls.map((c) => c.method), ["POST", "GET", "POST", "PATCH", "POST"]);
  assert.ok(calls[3]!.url.includes("/update-agent/agent1?version=3"));
  assert.equal((calls[3]!.body as { response_engine: { conversation_flow_id: string } }).response_engine.conversation_flow_id, "flow1");
  assert.equal((calls[4]!.body as { version: number }).version, 3);
});

test("ElevenLabs patches the selected agent with top-level workflow and updated personality", async () => {
  const { fetch, calls } = capturing({ "/v1/convai/agents/agent1": {} });
  const eleven = new ElevenLabsIntegration(fetch);
  const scripted = { ...spec, structured: undefined, persona: { name: "Busy", systemPrompt: "You are a busy customer" }, steps: [{ kind: "say" as const, text: "Hello" }, { kind: "hangup" as const }] };
  await eleven.updateTestingAgent(account, agentFrom("agent1"), scripted);
  assert.equal(calls[0]!.method, "PATCH");
  const body = calls[0]!.body as { workflow: { nodes: Record<string, unknown> }; conversation_config: { agent: { prompt: { prompt: string } } } };
  assert.ok(body.workflow.nodes.start_node);
  assert.equal(body.conversation_config.agent.prompt.prompt, "You are a busy customer");
});
