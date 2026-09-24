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
  body: unknown;
}

/** Fake fetch that records each request and returns canned bodies by route. */
function capturing(routes: Record<string, unknown>): { fetch: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = url.toString();
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find((k) => u.endsWith(k));
    return new Response(JSON.stringify(key ? routes[key] : {}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

const account: ProviderAccount = { id: "a", provider: "x", label: "L", credentials: { apiKey: "k", phoneNumberId: "pn", from: "+1" }, createdAt: 0 };
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

test("Vapi provisions a Workflow and calls with workflowId", async () => {
  const { fetch, calls } = capturing({ "/workflow": { id: "wf1" }, "/call": { id: "c1" } });
  const vapi = new VapiIntegration(fetch);
  const { externalAgentId } = await vapi.createTestingAgent(account, spec);
  assert.equal(externalAgentId, "wf1");
  assert.ok(calls.some((c) => c.url.endsWith("/workflow")));

  await vapi.placeCall(account, agentFrom("wf1"), { phoneNumber: "+14155550123" });
  const call = calls.find((c) => c.url.endsWith("/call"))!;
  assert.equal((call.body as { workflowId: string }).workflowId, "wf1");
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
    conversation_config: { agent: { workflow?: { nodes: unknown[] } } };
  };
  assert.ok(cfg.conversation_config.agent.workflow, "workflow embedded");
  assert.ok((cfg.conversation_config.agent.workflow!.nodes as unknown[]).length >= 2);
});
