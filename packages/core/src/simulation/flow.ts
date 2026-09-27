/**
 * Conversation-flow IR + per-platform node compilers.
 *
 * A Structured Test is first lowered to a provider-neutral node graph
 * (ConversationFlow): an ordered set of nodes (opener / say / instruction / end)
 * connected by conditional edges. Each hosted platform then serializes that IR
 * into its own node-based format so the testing agent follows the test
 * step-by-step:
 *   - Bland       → Pathway (nodes + edges)
 *   - Vapi        → Squad (one assistant per spoken turn)
 *   - Retell      → Conversation Flow (nodes + edges)
 *   - ElevenLabs  → Agent Workflow (nodes + edges)
 *
 * The graph is derived from the authored condition order (Cekura's guidance is
 * to order conditions in logical conversation flow), with `standard` conditions
 * becoming conditional transitions and `action_followup` becoming unconditional
 * next-turn transitions. `<endcall>` routes to a terminal End node.
 */
import type { ScenarioStep } from "../types.js";
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

/** Compile supported linear speech steps without falling back to a persona. */
export function stepsToFlow(steps: ScenarioStep[], role: string): ConversationFlow {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  let afterWait = false;
  let mayWait = false;
  function append(type: "say" | "end", text: string) {
    const id = `step${nodes.length}`;
    if (nodes.length) edges.push({ from: nodes[nodes.length - 1]!.id, to: id, when: "The other party has responded" });
    nodes.push({ id, type, text });
  }
  for (const [i, step] of steps.entries()) {
    if (step.kind === "say" && !step.delayMs) {
      append("say", step.text);
      afterWait = false;
      mayWait = true;
    } else if (step.kind === "wait" && step.timeoutMs === undefined && !step.until && mayWait) {
      afterWait = true;
      mayWait = false;
    } else if (step.kind === "hangup") {
      if (!nodes.length || afterWait) append("end", "");
      else nodes[nodes.length - 1]!.type = "end";
      return { role, start: nodes[0]!.id, nodes, edges };
    } else {
      throw new Error(`Hosted script step ${i + 1} (${step.kind}) cannot be reproduced exactly. Use say, untimed wait after speech, and hangup steps, or use a structured simulation. No call was placed.`);
    }
  }
  if (!nodes.length || afterWait) append("end", "");
  else nodes[nodes.length - 1]!.type = "end";
  return { role, start: nodes[0]!.id, nodes, edges };
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
        isStart: n.id === flow.start,
        ...(n.type === "instruction" ? { prompt: n.instruction } : {}),
        globalPrompt: flow.role,
        ...(n.text !== undefined ? { text: n.text } : {}),
      },
    })),
    edges: flow.edges.map((e, i) => {
      const label = !e.when || e.when === "The other party has responded" ? "always choose this pathway" : e.when;
      return {
        id: `e${i}`,
        source: e.from,
        target: e.to,
        label,
        data: { label, description: "Select this pathway after the other side speaks, regardless of their words." },
      };
    }),
  };
}

/** Vapi Squad: one transient assistant per speaking node, linked by handoff tools. */
export function toVapiSquad(flow: ConversationFlow, name = "HAL test", model = "gpt-4o-mini", voice?: string): Record<string, unknown> {
  const speaking = flow.nodes.filter((n) => n.type !== "end" || Boolean(n.text));
  if (!speaking.length) throw new Error("The Vapi squad needs at least one spoken step. No call was placed.");
  return {
    name,
    members: speaking.map((n) => {
      const next = flow.edges.filter((e) => e.from === n.id && speaking.some((item) => item.id === e.to));
      const destinations = next.map((e) => ({
        type: "assistant", assistantName: e.to,
        description: e.when && e.when !== "The other party has responded" ? e.when : "After the other party responds, continue to the next scripted step.",
      }));
      return {
        assistant: {
          name: n.id,
          firstMessage: n.text ?? "",
          firstMessageMode: n.text ? "assistant-speaks-first" : "assistant-waits-for-user",
          model: {
            provider: "openai", model,
            messages: [{ role: "system", content: `${flow.role}\nCurrent step: ${n.instruction ?? (n.text ? `Say exactly: ${n.text}` : "Listen.")}\n${destinations.length ? "After the other party replies, hand off using the available tool. Do not repeat this step." : "After this step, end the call. Do not repeat this step."}` }],
            tools: destinations.length ? [{ type: "handoff", destinations }] : [{ type: "endCall" }],
          },
          ...(voice ? { voice: { provider: "vapi", voiceId: voice } } : {}),
        },
        ...(destinations.length ? { assistantDestinations: destinations } : {}),
      };
    }),
  };
}

/** Retained for callers that preview the older Vapi Workflow format. */
export function toVapiWorkflow(flow: ConversationFlow, name = "HAL test"): Record<string, unknown> {
  return toVapiSquad(flow, name);
}

/** Retell Conversation Flow: nodes + edges with transition conditions. */
export function toRetellConversationFlow(
  flow: ConversationFlow,
  name = "HAL test",
): Record<string, unknown> {
  const spokenTerminal = flow.nodes.find((n) => n.type === "end" && n.text);
  const edges = spokenTerminal ? [...flow.edges, { from: spokenTerminal.id, to: "hal_end_call", when: "After speaking the final scripted line, end the call." }] : flow.edges;
  return {
    conversation_flow_name: name,
    global_prompt: flow.role,
    start_node_id: flow.start,
    start_speaker: "agent",
    model_choice: { type: "cascading", model: "gpt-4.1" },
    nodes: [...flow.nodes, ...(spokenTerminal ? [{ id: "hal_end_call", type: "end" as const }] : [])].map((n) => ({
      id: n.id,
      type: n.type === "end" && !n.text ? "end" : "conversation",
      instruction:
        n.type === "say" || (n.type === "end" && n.text)
          ? { type: "static_text", text: n.text }
          : n.type === "instruction"
            ? { type: "prompt", text: n.instruction }
            : n.type === "start"
              ? { type: "static_text", text: n.text }
              : undefined,
      edges: edges.filter((e) => e.from === n.id).map((e, i) => ({
        id: `edge_${n.id}_${i}`,
        destination_node_id: e.to,
        transition_condition: { type: "prompt", prompt: e.when ?? "After completing this step, continue." },
      })),
    })),
  };
}

/** ElevenLabs Agent Workflow: nodes + edges. */
export function toElevenLabsWorkflow(
  flow: ConversationFlow,
  name = "HAL test",
): Record<string, unknown> {
  const spokenTerminal = flow.nodes.find((n) => n.type === "end" && n.text);
  const nodes = spokenTerminal ? [...flow.nodes, { id: "hal_end_call", type: "end" as const }] : flow.nodes;
  const edges = spokenTerminal ? [...flow.edges, { from: spokenTerminal.id, to: "hal_end_call", when: "The final scripted line has been spoken." }] : flow.edges;
  return {
    name,
    workflow: {
      nodes: Object.fromEntries([
        ["start_node", { type: "start", edge_order: ["start_to_first"], position: { x: 0, y: 0 } }],
        ...nodes.map((n, i) => [n.id, {
          type: n.type === "end" && !n.text ? "end" : "override_agent",
          edge_order: edges.flatMap((e, j) => e.from === n.id ? [`edge_${j}`] : []),
          position: { x: 300 * (i + 1), y: 0 },
          ...(n.type === "end" && !n.text ? {} : {
            label: `Step ${i + 1}`,
            entry_behavior: n.text ? "generate_immediately" : "wait_for_user",
            additional_prompt: `${flow.role}\n${n.text ? `Say exactly this line and nothing else: ${n.text}` : n.instruction ?? "Listen to the other party."}`,
            conversation_config: n.text ? { agent: { first_message: n.text } } : {},
          }),
        }]),
      ]),
      edges: Object.fromEntries([
        ["start_to_first", { source: "start_node", target: flow.start, forward_condition: { type: "unconditional" } }],
        ...edges.map((e, i) => [`edge_${i}`, {
          source: e.from, target: e.to,
          forward_condition: e.when && e.when !== "The other party has responded"
            ? { type: "llm", condition: e.when }
            : { type: "llm", condition: "The other party has responded and the current scripted line has been spoken." },
        }]),
      ]),
    },
  };
}
