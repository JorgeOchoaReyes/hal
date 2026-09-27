import { Transcript } from "../../types.js";
import { asRecord, asText, eventTime, providerEvent, samePhoneNumber } from "./trace.js";
import { ProviderField } from "../templates.js";
import { structuredToFlow, stepsToFlow, toVapiSquad } from "../../simulation/flow.js";
import {
  VoiceProviderIntegration,
  ProviderAccount,
  TestingAgentSpec,
  HostedTestingAgent,
  HostedTarget,
  HostedCallState,
  HostedCallStatus,
  HostedRemoteAgent,
  FetchLike,
  CredentialCheck,
  safeText,
  resolveSpecPrompt,
  withTimeout,
} from "./integration.js";

/**
 * Vapi integration. Uses the user's Vapi API key to create an assistant (the
 * testing agent) and to place outbound calls from a Vapi phone number to the
 * target. `fetchImpl` is injectable so the adapter is unit-testable without
 * network access.
 */
export class VapiIntegration implements VoiceProviderIntegration {
  readonly id = "vapi";
  readonly label = "Vapi";
  readonly credentialFields: ProviderField[] = [
    { key: "apiKey", label: "Vapi API key", required: true },
    {
      key: "phoneNumberId",
      label: "Vapi phone number ID",
      required: true,
      help: "The Vapi phoneNumberId the testing agent calls from.",
    },
  ];

  private readonly fetchImpl: FetchLike;
  private readonly base: string;

  constructor(fetchImpl: FetchLike = fetch, baseUrl = "https://api.vapi.ai") {
    this.fetchImpl = withTimeout(fetchImpl);
    this.base = baseUrl.replace(/\/$/, "");
  }

  private headers(account: ProviderAccount): Record<string, string> {
    return {
      authorization: `Bearer ${account.credentials.apiKey ?? ""}`,
      "content-type": "application/json",
    };
  }

  async verifyCredentials(account: ProviderAccount): Promise<CredentialCheck> {
    try {
      const res = await this.fetchImpl(`${this.base}/assistant?limit=1`, {
        headers: this.headers(account),
      });
      return res.ok ? { ok: true } : { ok: false, detail: `${res.status}: ${(await safeText(res)).slice(0, 200)}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  buildFlowConfig(spec: TestingAgentSpec): Record<string, unknown> | null {
    const flow = spec.structured ? structuredToFlow(spec.structured) : spec.steps?.length ? stepsToFlow(spec.steps, spec.persona.systemPrompt) : null;
    return flow ? toVapiSquad(flow, spec.name, spec.model, spec.voice) : null;
  }

  /** Native Vapi assistant body — the deterministic reproduction of the spec. */
  buildAgentConfig(spec: TestingAgentSpec): Record<string, unknown> {
    const { systemPrompt, firstMessage } = resolveSpecPrompt(spec);
    return {
      name: spec.name,
      firstMessage: firstMessage ?? "Hello.",
      model: {
        provider: "openai",
        model: spec.model ?? "gpt-4o-mini",
        messages: [{ role: "system", content: systemPrompt }],
      },
      ...(spec.voice ? { voice: { provider: "vapi", voiceId: spec.voice } } : {}),
    };
  }

  async createTestingAgent(
    account: ProviderAccount,
    spec: TestingAgentSpec,
  ): Promise<{ externalAgentId: string }> {
    const squad = this.buildFlowConfig(spec);
    if (squad) {
      const res = await this.fetchImpl(`${this.base}/squad`, {
        method: "POST",
        headers: this.headers(account),
        body: JSON.stringify(squad),
      });
      if (!res.ok) throw new Error(`Vapi createSquad failed (${res.status}): ${await safeText(res)}`);
      const data = (await res.json()) as { id: string };
      return { externalAgentId: data.id };
    }

    const res = await this.fetchImpl(`${this.base}/assistant`, {
      method: "POST",
      headers: this.headers(account),
      body: JSON.stringify(this.buildAgentConfig(spec)),
    });
    if (!res.ok) throw new Error(`Vapi createAssistant failed (${res.status}): ${await safeText(res)}`);
    const data = (await res.json()) as { id: string };
    return { externalAgentId: data.id };
  }

  async getAgentVoice(account: ProviderAccount, externalAgentId: string): Promise<string | undefined> {
    const res = await this.fetchImpl(`${this.base}/assistant/${encodeURIComponent(externalAgentId)}`, { headers: this.headers(account) });
    if (!res.ok) return undefined;
    const data = await res.json() as { voice?: { voiceId?: string } };
    return data.voice?.voiceId;
  }

  async listAvailableVoices(): Promise<string[]> {
    return ["Elliot", "Emma", "Clara"];
  }

  async updateTestingAgent(account: ProviderAccount, agent: HostedTestingAgent, spec: TestingAgentSpec): Promise<{ externalAgentId?: string }> {
    const squad = this.buildFlowConfig(spec);
    if (!squad) throw new Error("Vapi needs scripted steps or a structured simulation to mold the selected tester. No call was placed.");
    // Imported assistants have no squad graph to patch. Convert the saved HAL
    // tester reference once, then patch the same squad for later simulations.
    const patch = agent.spec?.graphKind === "squad";
    const res = await this.fetchImpl(patch ? `${this.base}/squad/${agent.externalAgentId}` : `${this.base}/squad`, {
      method: patch ? "PATCH" : "POST", headers: this.headers(account), body: JSON.stringify(squad),
    });
    if (!res.ok) throw new Error(`Vapi ${patch ? "updateSquad" : "createSquad"} failed (${res.status}): ${await safeText(res)}`);
    const data = (await res.json()) as { id?: string };
    if (!patch && !data.id) throw new Error("Vapi createSquad returned no id. No call was placed.");
    return { externalAgentId: data.id ?? agent.externalAgentId };
  }

  async placeCall(
    account: ProviderAccount,
    agent: HostedTestingAgent,
    target: HostedTarget,
  ): Promise<{ externalCallId: string }> {
    const ref = agent.spec?.graphKind === "squad" ? { squadId: agent.externalAgentId } : { assistantId: agent.externalAgentId };
    const res = await this.fetchImpl(`${this.base}/call`, {
      method: "POST",
      headers: this.headers(account),
      body: JSON.stringify({
        ...ref,
        phoneNumberId: account.credentials.phoneNumberId,
        customer: { number: target.phoneNumber },
      }),
    });
    if (!res.ok) throw new Error(`Vapi createCall failed (${res.status}): ${await safeText(res)}`);
    const data = (await res.json()) as { id: string };
    return { externalCallId: data.id };
  }

  async getCall(account: ProviderAccount, externalCallId: string): Promise<HostedCallState> {
    const res = await this.fetchImpl(`${this.base}/call/${externalCallId}`, {
      headers: this.headers(account),
    });
    if (!res.ok) throw new Error(`Vapi getCall failed (${res.status}): ${await safeText(res)}`);
    const data = (await res.json()) as VapiCall;
    return {
      externalCallId,
      status: mapStatus(data.status),
      transcript: parseVapiTranscript(data),
      details: asRecord(data),
      trace: parseVapiTrace(data),
      endedReason: data.endedReason,
    };
  }

  async getRecording(account: ProviderAccount, externalCallId: string): Promise<Response> {
    return this.fetchImpl(`${this.base}/call/${encodeURIComponent(externalCallId)}/mono-recording`, {
      headers: this.headers(account), signal: AbortSignal.timeout(60_000),
    });
  }

  async findInboundCall(account: ProviderAccount, opts: {
    toNumber: string; fromNumber?: string; startedAt: number; excludeCallId: string; externalAgentId?: string;
  }): Promise<string | undefined> {
    const query = new URLSearchParams({ limit: "1000", createdAtGe: new Date(opts.startedAt - 120_000).toISOString(),
      createdAtLe: new Date(opts.startedAt + 120_000).toISOString() });
    const res = await this.fetchImpl(`${this.base}/call?${query}`, { headers: this.headers(account) });
    if (!res.ok) return undefined;
    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return undefined;
    const matches = rows.map(asRecord).filter((row) => {
      const at = eventTime(row.createdAt);
      const phone = asRecord(row.phoneNumber);
      const customer = asRecord(row.customer);
      return row.type === "inboundPhoneCall" && row.id !== opts.excludeCallId
        && at !== undefined && Math.abs(at - opts.startedAt) <= 120_000
        && (!opts.externalAgentId || row.assistantId === opts.externalAgentId || row.squadId === opts.externalAgentId)
        && samePhoneNumber(phone.number ?? row.phoneNumber, opts.toNumber)
        && (!opts.fromNumber || samePhoneNumber(customer.number, opts.fromNumber));
    });
    return matches.length === 1 ? asText(matches[0]?.id) : undefined;
  }

  /**
   * List the account's existing Vapi assistants, so "My agents" can import one
   * (the real agent under test) instead of manual entry. GET /assistant is the
   * same list endpoint verifyCredentials probes.
   */
  async listRemoteAgents(account: ProviderAccount): Promise<HostedRemoteAgent[]> {
    const res = await this.fetchImpl(`${this.base}/assistant`, { headers: this.headers(account) });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => null)) as unknown;
    const rows = Array.isArray(data) ? data : [];
    const out: HostedRemoteAgent[] = [];
    for (const r of rows as Array<Record<string, unknown>>) {
      const id = String(r.id ?? "").trim();
      if (!id) continue;
      const mode = asText(r.firstMessageMode);
      const firstMessage = mode === "assistant-waits-for-user" ? undefined : asText(r.firstMessage);
      out.push({ id, name: String(r.name ?? id).trim(), kind: "agent", ...(firstMessage ? { firstMessage } : {}) });
    }
    return out;
  }
}

interface VapiMessage {
  role?: string;
  message?: string;
  content?: unknown;
  time?: number;
  secondsFromStart?: number;
  [key: string]: unknown;
}
interface VapiCall {
  status?: string;
  endedReason?: string;
  transcript?: string;
  messages?: VapiMessage[];
  artifact?: { messages?: VapiMessage[] };
  [key: string]: unknown;
}

function mapStatus(status?: string): HostedCallStatus {
  switch (status) {
    case "queued":
    case "ringing":
    case "scheduled":
      return "queued";
    case "in-progress":
    case "forwarding":
      return "in-progress";
    case "ended":
    case "completed":
      return "ended";
    default:
      return status ? "failed" : "queued";
  }
}

/**
 * Map Vapi's structured messages to a HAL transcript. The Vapi assistant is our
 * testing AGENT (caller); the other party ("user") is the TARGET under test.
 */
function parseVapiTranscript(call: VapiCall): Transcript | undefined {
  const msgs = (call.artifact?.messages?.length ?? 0) > (call.messages?.length ?? 0) ? call.artifact?.messages : call.messages;
  if (!msgs || msgs.length === 0) return undefined;
  const base = eventTime(asRecord(call).startedAt) ?? Date.now();
  const out: Transcript = [];
  for (const m of msgs) {
    const role = m.role?.toLowerCase();
    if (role !== "user" && role !== "bot" && role !== "assistant") continue; // skip system/tool
    const text = asText(m.message ?? m.content);
    if (!text) continue;
    out.push({
      role: role === "user" ? "target" : "agent",
      text,
      startedAt: eventTime(m.time, base) ?? base + (m.secondsFromStart ?? 0) * 1000,
      audioStartMs: typeof m.secondsFromStart === "number" ? Math.max(0, m.secondsFromStart * 1000)
        : eventTime(m.time, base) !== undefined ? Math.max(0, eventTime(m.time, base)! - base) : undefined,
      meta: { ...m },
    });
  }
  return out.length ? out : undefined;
}

function parseVapiTrace(call: VapiCall) {
  const messages = (call.artifact?.messages?.length ?? 0) > (call.messages?.length ?? 0)
    ? call.artifact?.messages ?? [] : call.messages ?? [];
  const base = eventTime(asRecord(call).startedAt) ?? Date.now();
  return messages.flatMap((message) => {
    const role = message.role?.toLowerCase();
    const data = asRecord(message);
    const type = asText(data.type)?.toLowerCase() ?? "";
    const at = eventTime(message.time, base) ?? eventTime(message.secondsFromStart, base);
    if (type.startsWith("workflow.node.")) {
      const nodeId = asText(data.nodeId ?? data.node_id ?? asRecord(data.node).id);
      return [providerEvent("node", nodeId ?? type, data, at, nodeId)];
    }
    const tool = asRecord((Array.isArray(data.toolCallList) ? data.toolCallList[0] : undefined) ?? data.toolCall);
    const label = asText(data.toolName ?? data.name ?? tool.name ?? asRecord(tool.function).name);
    if (role === "tool" || role?.includes("result") || type.includes("tool-result")) {
      return [providerEvent("tool-result", label ?? "Tool result", data, at)];
    }
    if (role?.includes("tool") || role === "function_call" || type.includes("tool-call") || data.toolCalls || data.toolCallList) {
      return [providerEvent("tool-call", label ?? "Tool call", data, at)];
    }
    return [];
  });
}
