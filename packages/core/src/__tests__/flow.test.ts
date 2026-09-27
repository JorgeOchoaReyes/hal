import { test } from "node:test";
import assert from "node:assert/strict";
import {
  structuredToFlow,
  toBlandPathway,
  toVapiSquad,
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

test("Vapi / Retell / ElevenLabs serializers produce provider-native graphs", () => {
  const flow = structuredToFlow(sample);
  const vapi = toVapiSquad(flow) as { members: Array<{ assistant: { model: { tools: unknown[] } } }> };
  assert.equal(vapi.members.length, 3);
  assert.ok(vapi.members[0]!.assistant.model.tools.length);

  const retell = toRetellConversationFlow(flow) as {
    start_node_id: string;
    nodes: Array<{ edges?: unknown[] }>;
    model_choice: { type: string };
    start_speaker: string;
  };
  assert.equal(retell.start_node_id, "start");
  assert.equal(retell.start_speaker, "agent");
  assert.equal(retell.model_choice.type, "cascading");
  assert.ok(retell.nodes.length >= 3);
  assert.ok(retell.nodes[0]!.edges?.length);

  const el = toElevenLabsWorkflow(flow) as { workflow: { nodes: Record<string, unknown>; edges: Record<string, unknown> } };
  assert.ok(Object.keys(el.workflow.nodes).length >= 3);
  assert.equal((el.workflow.nodes.start_node as { type: string }).type, "start");
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

test("each authored say is a separate Bland turn and hangup speaks only the final line", async () => {
  const { stepsToFlow } = await import("../simulation/flow.js");
  const flow = stepsToFlow([
    { kind: "say", text: "Hi, I'd like some help please." },
    { kind: "say", text: "Hey i need help sap" },
    { kind: "say", text: "need to help now" },
    { kind: "say", text: "hello?" },
    { kind: "hangup" },
  ], "You are a polite but busy customer calling a business. Answer questions directly.");
  assert.deepEqual(flow.nodes.map((node) => node.text), [
    "Hi, I'd like some help please.", "Hey i need help sap", "need to help now", "hello?",
  ]);
  assert.deepEqual(flow.nodes.map((node) => node.type), ["say", "say", "say", "end"]);
  assert.deepEqual(flow.edges.map((edge) => edge.when), [
    "The other party has responded", "The other party has responded", "The other party has responded",
  ]);
  const pathway = toBlandPathway(flow, "HAL tester") as {
    nodes: Array<{ type: string; data: { text?: string; globalPrompt: string } }>;
    edges: Array<{ source: string; target: string; label: string; data: { label: string; description: string } }>;
  };
  assert.deepEqual(pathway.nodes.map((node) => node.data.text), flow.nodes.map((node) => node.text));
  assert.equal(pathway.nodes[3]?.type, "End Call");
  assert.ok(pathway.nodes.every((node) => node.data.globalPrompt === flow.role));
  assert.deepEqual(pathway.edges.map((edge) => [edge.source, edge.target, edge.label]), [
    ["step0", "step1", "always choose this pathway"],
    ["step1", "step2", "always choose this pathway"],
    ["step2", "step3", "always choose this pathway"],
  ]);
  assert.ok(pathway.edges.every((edge) => edge.data.label === "always choose this pathway" && edge.data.description.includes("regardless")));
});

test("all hosted graph serializers keep every dictated line and the terminal hangup", async () => {
  const { stepsToFlow } = await import("../simulation/flow.js");
  const lines = ["Hi, I'd like some help please.", "Hey i need help sap", "need to help now", "hello?"];
  const flow = stepsToFlow([...lines.map((text) => ({ kind: "say" as const, text })), { kind: "hangup" }], "You are a polite but busy customer calling a business. Answer questions directly.");
  const vapi = toVapiSquad(flow) as { members: Array<{ assistant: { firstMessage: string; model: { messages: Array<{ content: string }>; tools: Array<{ type: string }> } } }> };
  assert.deepEqual(vapi.members.map((m) => m.assistant.firstMessage), lines);
  assert.ok(vapi.members.every((m) => m.assistant.model.messages[0]!.content.includes(flow.role)));
  assert.equal(vapi.members.at(-1)!.assistant.model.tools[0]!.type, "endCall");
  const retell = toRetellConversationFlow(flow) as { nodes: Array<{ id: string; type: string; instruction?: { text: string }; edges: Array<{ destination_node_id: string }> }> };
  assert.deepEqual(retell.nodes.filter((n) => n.instruction?.text).map((n) => n.instruction!.text), lines);
  assert.equal(retell.nodes.at(-1)!.type, "end");
  assert.equal(retell.nodes.at(-2)!.edges[0]!.destination_node_id, "hal_end_call");
  const eleven = toElevenLabsWorkflow(flow) as { workflow: { nodes: Record<string, { type: string; additional_prompt?: string }>; edges: Record<string, unknown> } };
  assert.ok(lines.every((line, i) => eleven.workflow.nodes[`step${i}`]!.additional_prompt?.includes(line)));
  assert.equal(eleven.workflow.nodes.hal_end_call!.type, "end");
  assert.equal(Object.keys(eleven.workflow.edges).length, 5);
});
