import { Transcript } from "../../types.js";
import { asRecord, asText, eventTime, providerEvent } from "./trace.js";
import { ProviderField } from "../templates.js";
import { structuredToFlow, stepsToFlow, toElevenLabsWorkflow } from "../../simulation/flow.js";
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
 * ElevenLabs Conversational AI integration. Creates a ConvAI agent as the
 * testing agent and places outbound calls through the user's configured
 * ElevenLabs phone number (Twilio-backed). `fetchImpl` is injectable for tests.
 */
export class ElevenLabsIntegration implements VoiceProviderIntegration {
  readonly id = "elevenlabs";
  readonly label = "ElevenLabs";
  readonly credentialFields: ProviderField[] = [
    { key: "apiKey", label: "ElevenLabs API key", required: true },
    {
      key: "phoneNumberId",
      label: "Agent phone number ID",
      required: true,
      help: "The ElevenLabs phone number id the testing agent calls from.",
    },
  ];

  private readonly fetchImpl: FetchLike;
  private readonly base: string;

  constructor(fetchImpl: FetchLike = fetch, baseUrl = "https://api.elevenlabs.io") {
    this.fetchImpl = withTimeout(fetchImpl);
    this.base = baseUrl.replace(/\/$/, "");
  }

  private headers(account: ProviderAccount): Record<string, string> {
    return {
      "xi-api-key": account.credentials.apiKey ?? "",
      "content-type": "application/json",
    };
  }

  async verifyCredentials(account: ProviderAccount): Promise<CredentialCheck> {
    try {
      const res = await this.fetchImpl(`${this.base}/v1/user`, { headers: this.headers(account) });
      return res.ok ? { ok: true } : { ok: false, detail: `${res.status}: ${(await safeText(res)).slice(0, 200)}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  buildFlowConfig(spec: TestingAgentSpec): Record<string, unknown> | null {
    const flow = spec.structured ? structuredToFlow(spec.structured) : spec.steps?.length ? stepsToFlow(spec.steps, spec.persona.systemPrompt) : null;
    return flow ? toElevenLabsWorkflow(flow, spec.name) : null;
  }

  /** Native ElevenLabs ConvAI agent body — deterministic reproduction of the spec. */
  buildAgentConfig(spec: TestingAgentSpec): Record<string, unknown> {
    const { systemPrompt, firstMessage } = resolveSpecPrompt(spec);
    const scriptedFirst = spec.steps?.find((step) => step.kind === "say")?.text;
    const agent: Record<string, unknown> = {
      prompt: { prompt: systemPrompt },
      first_message: firstMessage ?? scriptedFirst ?? "Hello.",
    };
    const flow = this.buildFlowConfig(spec) as { workflow?: unknown } | null;
    return { name: spec.name, conversation_config: { agent, ...(spec.voice ? { tts: { voice_id: spec.voice } } : {}) }, ...(flow?.workflow ? { workflow: flow.workflow } : {}) };
  }

  async getAgentVoice(account: ProviderAccount, externalAgentId: string): Promise<string | undefined> {
    const res = await this.fetchImpl(`${this.base}/v1/convai/agents/${encodeURIComponent(externalAgentId)}`, { headers: this.headers(account) });
    if (!res.ok) return undefined;
    const data = await res.json() as { conversation_config?: { tts?: { voice_id?: string } } };
    return data.conversation_config?.tts?.voice_id;
  }

  async listAvailableVoices(account: ProviderAccount): Promise<string[]> {
    const res = await this.fetchImpl(`${this.base}/v2/voices?page_size=100`, { headers: this.headers(account) });
    if (!res.ok) throw new Error(`ElevenLabs could not list voices (${res.status}): ${await safeText(res)}`);
    const data = await res.json() as { voices?: Array<{ voice_id?: string }> };
    return (data.voices ?? []).map((voice) => voice.voice_id).filter((id): id is string => !!id);
  }

  async updateTestingAgent(account: ProviderAccount, agent: HostedTestingAgent, spec: TestingAgentSpec): Promise<void> {
    const config = this.buildAgentConfig(spec);
    if (!("workflow" in config)) throw new Error("ElevenLabs needs scripted steps or a structured simulation to mold the selected tester. No call was placed.");
    const res = await this.fetchImpl(`${this.base}/v1/convai/agents/${agent.externalAgentId}`, {
      method: "PATCH", headers: this.headers(account), body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error(`ElevenLabs updateAgent failed (${res.status}): ${await safeText(res)}`);
  }

  async createTestingAgent(
    account: ProviderAccount,
    spec: TestingAgentSpec,
  ): Promise<{ externalAgentId: string }> {
    const res = await this.fetchImpl(`${this.base}/v1/convai/agents/create`, {
      method: "POST",
      headers: this.headers(account),
      body: JSON.stringify(this.buildAgentConfig(spec)),
    });
    if (!res.ok) throw new Error(`ElevenLabs createAgent failed (${res.status}): ${await safeText(res)}`);
    const data = (await res.json()) as { agent_id: string };
    return { externalAgentId: data.agent_id };
  }

  async placeCall(
    account: ProviderAccount,
    agent: HostedTestingAgent,
    target: HostedTarget,
  ): Promise<{ externalCallId: string }> {
    const res = await this.fetchImpl(`${this.base}/v1/convai/twilio/outbound-call`, {
      method: "POST",
      headers: this.headers(account),
      body: JSON.stringify({
        agent_id: agent.externalAgentId,
        agent_phone_number_id: account.credentials.phoneNumberId,
        to_number: target.phoneNumber,
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs outbound-call failed (${res.status}): ${await safeText(res)}`);
    const data = (await res.json()) as { conversation_id?: string; callSid?: string };
    const callId = data.conversation_id ?? data.callSid;
    if (!callId) throw new Error("ElevenLabs outbound-call returned no conversation id");
    return { externalCallId: callId };
  }

  async getCall(account: ProviderAccount, externalCallId: string): Promise<HostedCallState> {
    const res = await this.fetchImpl(`${this.base}/v1/convai/conversations/${externalCallId}`, {
      headers: this.headers(account),
    });
    if (!res.ok) throw new Error(`ElevenLabs getConversation failed (${res.status}): ${await safeText(res)}`);
    const data = (await res.json()) as ElevenConversation;
    return {
      externalCallId,
      status: mapStatus(data.status),
      transcript: parseTranscript(data),
      details: asRecord(data), trace: parseElevenTrace(data),
    };
  }

  async getRecording(account: ProviderAccount, externalCallId: string): Promise<Response> {
    return this.fetchImpl(`${this.base}/v1/convai/conversations/${encodeURIComponent(externalCallId)}/audio`, {
      headers: this.headers(account), signal: AbortSignal.timeout(60_000),
    });
  }

  async findInboundCall(account: ProviderAccount, opts: {
    toNumber: string; fromNumber?: string; startedAt: number; excludeCallId: string; externalAgentId?: string;
  }): Promise<string | undefined> {
    if (!opts.externalAgentId) return undefined;
    const query = new URLSearchParams({ agent_id: opts.externalAgentId,
      call_start_after_unix: String(Math.floor((opts.startedAt - 120_000) / 1000)),
      call_start_before_unix: String(Math.ceil((opts.startedAt + 120_000) / 1000)),
      page_size: "100" });
    const res = await this.fetchImpl(`${this.base}/v1/convai/conversations?${query}`, { headers: this.headers(account) });
    if (!res.ok) return undefined;
    const rows = asRecord(await res.json()).conversations;
    if (!Array.isArray(rows)) return undefined;
    const matches = rows.map(asRecord).filter((row) => {
      const at = eventTime(row.start_time_unix_secs);
      return row.conversation_id !== opts.excludeCallId && row.agent_id === opts.externalAgentId
        && (row.direction === "inbound" || row.direction === undefined)
        && at !== undefined && Math.abs(at - opts.startedAt) <= 120_000;
    });
    return matches.length === 1 ? asText(matches[0]?.conversation_id) : undefined;
  }

  /**
   * List the account's existing ElevenLabs ConvAI agents, so "My agents" can
   * import one instead of manual entry (GET /v1/convai/agents).
   */
  async listRemoteAgents(account: ProviderAccount): Promise<HostedRemoteAgent[]> {
    const res = await this.fetchImpl(`${this.base}/v1/convai/agents`, { headers: this.headers(account) });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => null)) as unknown;
    const raw = (data && typeof data === "object" && "agents" in data
      ? (data as { agents: unknown }).agents
      : data) as unknown;
    const rows = Array.isArray(raw) ? raw : [];
    const out: HostedRemoteAgent[] = [];
    for (const r of rows as Array<Record<string, unknown>>) {
      const id = String(r.agent_id ?? "").trim();
      if (!id) continue;
      out.push({ id, name: String(r.name ?? id).trim(), kind: "agent" });
    }
    return out;
  }
}

interface ElevenTurn {
  role?: string;
  message?: string;
  text?: string;
  time_in_call_secs?: number;
  tool_calls?: unknown[];
  tool_results?: unknown[];
  [key: string]: unknown;
}
interface ElevenConversation {
  status?: string;
  transcript?: ElevenTurn[];
  metadata?: { start_time_unix_secs?: number; [key: string]: unknown };
  [key: string]: unknown;
}

function mapStatus(status?: string): HostedCallStatus {
  switch (status) {
    case "initiated":
    case "in-progress":
    case "processing":
      return "in-progress";
    case "done":
    case "completed":
    case "ended":
      return "ended";
    case "failed":
      return "failed";
    default:
      return status ? "in-progress" : "queued";
  }
}

function parseTranscript(conv: ElevenConversation): Transcript | undefined {
  if (!conv.transcript?.length) return undefined;
  const base = eventTime(conv.metadata?.start_time_unix_secs) ?? Date.now();
  const out: Transcript = [];
  for (const t of conv.transcript) {
    const role = t.role?.toLowerCase();
    const text = (t.message ?? t.text ?? "").trim();
    if (!text) continue;
    // ElevenLabs: "agent" is our testing agent (caller); "user" is the target.
    out.push({
      role: role === "user" ? "target" : "agent",
      text,
      startedAt: base + (t.time_in_call_secs ?? 0) * 1000,
      audioStartMs: typeof t.time_in_call_secs === "number" ? Math.max(0, t.time_in_call_secs * 1000) : undefined,
      meta: { ...t, ...(asText(t.node_id ?? t.workflow_node_id) ? { nodeId: t.node_id ?? t.workflow_node_id } : {}) },
    });
  }
  return out.length ? out : undefined;
}

function parseElevenTrace(conv: ElevenConversation) {
  const base = eventTime(conv.metadata?.start_time_unix_secs) ?? Date.now();
  return (conv.transcript ?? []).flatMap((turn) => {
    const at = base + (turn.time_in_call_secs ?? 0) * 1000;
    const events = [
      ...(turn.tool_calls ?? []).map((item) => providerEvent("tool-call", asText(asRecord(item).tool_name ?? asRecord(item).name) ?? "Tool call", item, at)),
      ...(turn.tool_results ?? []).map((item) => providerEvent("tool-result", asText(asRecord(item).tool_name ?? asRecord(item).name) ?? "Tool result", item, at)),
    ];
    const nodeId = asText(turn.node_id ?? turn.workflow_node_id);
    if (nodeId) events.push(providerEvent("node", nodeId, turn, at, nodeId));
    return events;
  });
}
