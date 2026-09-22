/**
 * Conversation-flow IR + per-platform node compilers.
 *
 * A Structured Test is first lowered to a provider-neutral node graph
 * (ConversationFlow): an ordered set of nodes (opener / say / instruction / end)
 * connected by conditional edges. Each hosted platform then serializes that IR
 * into its own node-based format so the testing agent follows the test
 * step-by-step:
 *   - Bland       → Pathway (nodes + edges)
 *   - Vapi        → Workflow (nodes + edges)
 *   - Retell      → Conversation Flow (nodes + edges)
 *   - ElevenLabs  → Agent Workflow (nodes + edges)
 *
 * The graph is derived from the authored condition order (Cekura's guidance is
 * to order conditions in logical conversation flow), with `standard` conditions
 * becoming conditional transitions and `action_followup` becoming unconditional
 * next-turn transitions. `<endcall>` routes to a terminal End node.
 */
import { StructuredTest, renderFixedMessage } from "./structured.js";

export type FlowNodeType = "start" | "say" | "instruction" | "end";

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  /** Verbatim line for start/say nodes. */
  text?: string;
  /** Instruction to interpret for instruction nodes. */
  instruction?: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  /** Natural-language trigger; undefined = always/next turn. */
  when?: string;
}

export interface ConversationFlow {
  role: string;
  start: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** Lower a Structured Test into the provider-neutral conversation-flow IR. */
export function structuredToFlow(test: StructuredTest): ConversationFlow {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const endId = "end";

  const ordered = [...test.conditions].sort((a, b) => a.id - b.id);
  const first = ordered.find((c) => c.id === 0);
  const startText = first ? renderFixedMessage(first.action).text : "";
  nodes.push({ id: "start", type: "start", text: startText });

  let prev = "start";
  let prevEndedCall = first ? renderFixedMessage(first.action).endCall : false;

  for (const c of ordered) {
    if (c.id === 0) continue;
    const nodeId = `n${c.id}`;
    const rendered = c.fixed_message ? renderFixedMessage(c.action) : { text: "", endCall: false };
    nodes.push(
      c.fixed_message
        ? { id: nodeId, type: "say", text: rendered.text }
        : { id: nodeId, type: "instruction", instruction: c.action },
    );
    // Transition into this node from the previous one.
    if (!prevEndedCall) {
      edges.push({
        from: prev,
        to: nodeId,
        when: c.type === "standard" ? String(c.condition) : undefined,
      });
    }
    prev = nodeId;
    prevEndedCall = c.fixed_message && rendered.endCall;
    if (prevEndedCall) edges.push({ from: nodeId, to: endId });
  }

  nodes.push({ id: endId, type: "end" });
  if (!prevEndedCall) edges.push({ from: prev, to: endId });

  return { role: test.role, start: "start", nodes, edges };
}

// --- Per-platform serializers ------------------------------------------------

/** Bland AI Pathway: nodes (Default / End Call) + edges with condition labels. */
export function toBlandPathway(flow: ConversationFlow, name = "HAL test"): Record<string, unknown> {
  return {
    name,
    nodes: flow.nodes.map((n) => ({
      id: n.id,
      type: n.type === "end" ? "End Call" : "Default",
      data: {
        name: n.id,
        isStart: n.type === "start",
        ...(n.type === "instruction" ? { prompt: n.instruction } : {}),
        ...(n.text ? { text: n.text } : {}),
      },
    })),
    edges: flow.edges.map((e, i) => ({
      id: `e${i}`,
      source: e.from,
      target: e.to,
      label: e.when ?? "proceed",
    })),
  };
}

/** Vapi Workflow: conversation nodes + edges with AI conditions. */
export function toVapiWorkflow(flow: ConversationFlow, name = "HAL test"): Record<string, unknown> {
  return {
    name,
    nodes: flow.nodes.map((n) => ({
      name: n.id,
      type: n.type === "end" ? "hangup" : "conversation",
      ...(n.type === "start" || n.type === "say" ? { firstMessage: n.text } : {}),
      ...(n.type === "instruction" ? { prompt: n.instruction } : {}),
      isStart: n.type === "start",
    })),
    edges: flow.edges.map((e) => ({
      from: e.from,
      to: e.to,
      condition: e.when ? { type: "ai", prompt: e.when } : { type: "always" },
    })),
  };
}

/** Retell Conversation Flow: nodes + edges with transition conditions. */
export function toRetellConversationFlow(
  flow: ConversationFlow,
  name = "HAL test",
): Record<string, unknown> {
  return {
    conversation_flow_name: name,
    global_prompt: flow.role,
    start_node_id: flow.start,
    nodes: flow.nodes.map((n) => ({
      id: n.id,
      type: n.type === "end" ? "end" : "conversation",
      instruction:
        n.type === "say"
          ? { type: "static_text", text: n.text }
          : n.type === "instruction"
            ? { type: "prompt", text: n.instruction }
            : n.type === "start"
              ? { type: "static_text", text: n.text }
              : undefined,
    })),
    edges: flow.edges.map((e, i) => ({
      id: `edge_${i}`,
      source_node_id: e.from,
      target_node_id: e.to,
      transition_condition: e.when
        ? { type: "prompt", prompt: e.when }
        : { type: "unconditional" },
    })),
  };
}

/** ElevenLabs Agent Workflow: nodes + edges. */
export function toElevenLabsWorkflow(
  flow: ConversationFlow,
  name = "HAL test",
): Record<string, unknown> {
  return {
    name,
    workflow: {
      start_node_id: flow.start,
      nodes: flow.nodes.map((n) => ({
        id: n.id,
        type: n.type === "end" ? "end" : "conversation",
        ...(n.text ? { message: n.text } : {}),
        ...(n.instruction ? { prompt: n.instruction } : {}),
      })),
      edges: flow.edges.map((e) => ({
        source: e.from,
        target: e.to,
        ...(e.when ? { condition: e.when } : {}),
      })),
    },
  };
}
