import { test } from "node:test";
import assert from "node:assert/strict";
import {
  structuredToFlow,
  toBlandPathway,
  toVapiWorkflow,
  toRetellConversationFlow,
  toElevenLabsWorkflow,
  RetellIntegration,
  type StructuredTest,
} from "../index.js";

const sample: StructuredTest = {
  role: "You are a patient booking an appointment",
  conditions: [
    { id: 0, condition: "FIRST_MESSAGE", action: "Hi, I'd like to book.", type: "standard", fixed_message: true },
    { id: 1, condition: "The agent asks which day", action: "Ask for Tuesday", type: "standard", fixed_message: false },
    { id: 2, condition: 1, action: "Great, thanks! <endcall />", type: "action_followup", fixed_message: true },
  ],
};

test("structuredToFlow builds start/say/instruction/end nodes with edges", () => {
  const flow = structuredToFlow(sample);
  assert.equal(flow.start, "start");
  const types = flow.nodes.map((n) => n.type);
  assert.ok(types.includes("start"));
  assert.ok(types.includes("instruction")); // n1 (fixed_message false)
  assert.ok(types.includes("say")); // n2
  assert.ok(types.includes("end"));

  // Opener text captured on the start node.
  assert.equal(flow.nodes.find((n) => n.id === "start")!.text, "Hi, I'd like to book.");
  // The endcall action routes n2 -> end.
  assert.ok(flow.edges.some((e) => e.from === "n2" && e.to === "end"));
  // The standard condition becomes a conditional edge.
  assert.ok(flow.edges.some((e) => e.to === "n1" && e.when === "The agent asks which day"));
});

test("Bland pathway serializer marks the start node and an End Call node", () => {
  const p = toBlandPathway(structuredToFlow(sample)) as {
    nodes: Array<{ id: string; type: string; data: { isStart?: boolean } }>;
    edges: unknown[];
  };
  assert.ok(p.nodes.some((n) => n.data.isStart));
  assert.ok(p.nodes.some((n) => n.type === "End Call"));
  assert.ok(p.edges.length >= 2);
});

test("Vapi / Retell / ElevenLabs serializers produce nodes + edges", () => {
  const flow = structuredToFlow(sample);
  const vapi = toVapiWorkflow(flow) as { nodes: unknown[]; edges: unknown[] };
  assert.ok(vapi.nodes.length >= 3 && vapi.edges.length >= 2);

  const retell = toRetellConversationFlow(flow) as {
    start_node_id: string;
    nodes: unknown[];
    edges: unknown[];
  };
  assert.equal(retell.start_node_id, "start");
  assert.ok(retell.nodes.length >= 3);

  const el = toElevenLabsWorkflow(flow) as { workflow: { nodes: unknown[]; edges: unknown[] } };
  assert.ok(el.workflow.nodes.length >= 3);
});

test("Retell buildFlowConfig emits a conversation flow; structured create binds a flow", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = url.toString();
    calls.push(u);
    const body =
      u.endsWith("/create-conversation-flow")
        ? { conversation_flow_id: "cf_1" }
        : u.endsWith("/create-agent")
          ? { agent_id: "agent_1" }
          : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

  const retell = new RetellIntegration(fetchImpl);
  const spec = { name: "T", persona: { name: "T", systemPrompt: "x" }, structured: sample };
  assert.ok(retell.buildFlowConfig(spec));

  const account = { id: "a", provider: "retell", label: "R", credentials: { apiKey: "k", from: "+1" }, createdAt: 0 };
  const { externalAgentId } = await retell.createTestingAgent(account, spec);
  assert.equal(externalAgentId, "agent_1");
  assert.ok(calls.some((c) => c.endsWith("/create-conversation-flow")));
  assert.ok(calls.some((c) => c.endsWith("/create-agent")));
});

test("linear scripts preserve speech, wait boundaries and terminal hangup", async () => {
  const { stepsToFlow } = await import("../simulation/flow.js");
  const flow = stepsToFlow([{ kind: "say", text: "Hello." }, { kind: "wait" }, { kind: "say", text: "Thank you." }, { kind: "hangup" }, { kind: "say", text: "Unreachable" }], "Tester");
  assert.equal(flow.nodes.length, 2);
  assert.equal(flow.nodes[0]!.text, "Hello.");
  assert.equal(flow.nodes[1]!.type, "end");
  assert.equal(flow.nodes[1]!.text, "Thank you.");
  assert.equal(flow.edges[0]!.when, "The other party has responded");
  assert.throws(() => stepsToFlow([{ kind: "expect", assertion: { kind: "contains", text: "hello" } } as any], "Tester"), /cannot be reproduced exactly/);
});
