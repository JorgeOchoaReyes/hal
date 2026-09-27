import { Transcript } from "../../types.js";
import { ProviderField } from "../templates.js";
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
import { structuredToFlow, stepsToFlow, toRetellConversationFlow } from "../../simulation/flow.js";

/**
 * Retell AI integration. Creates a Retell LLM (carrying the compiled prompt) and
 * an agent bound to it, then places an outbound call overriding that agent.
 * `buildFlowConfig` also emits Retell's native Conversation Flow graph.
 * `fetchImpl` is injectable for unit tests.
 */
export class RetellIntegration implements VoiceProviderIntegration {
  readonly id = "retell";
  readonly label = "Retell AI";
  readonly credentialFields: ProviderField[] = [
    { key: "apiKey", label: "Retell API key", required: true },
    {
      key: "from",
      label: "From number (E.164)",
      required: true,
      help: "A phone number registered in your Retell account to call from.",
    },
  ];

  private readonly fetchImpl: FetchLike;
  private readonly base: string;

  constructor(fetchImpl: FetchLike = fetch, baseUrl = "https://api.retellai.com") {
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
      const res = await this.fetchImpl(`${this.base}/list-agents`, { headers: this.headers(account) });
      return res.ok ? { ok: true } : { ok: false, detail: `${res.status}: ${(await safeText(res)).slice(0, 200)}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  buildFlowConfig(spec: TestingAgentSpec): Record<string, unknown> | null {
    const flow = spec.structured ? structuredToFlow(spec.structured) : spec.steps?.length ? stepsToFlow(spec.steps, spec.persona.systemPrompt) : null;
    return flow ? toRetellConversationFlow(flow, spec.name) : null;
  }

  /** The Retell LLM body (prompt-based); carries the compiled deterministic script. */
  buildAgentConfig(spec: TestingAgentSpec): Record<string, unknown> {
    const { systemPrompt, firstMessage } = resolveSpecPrompt(spec);
    return { general_prompt: systemPrompt, begin_message: firstMessage };
  }

  async createTestingAgent(
    account: ProviderAccount,
    spec: TestingAgentSpec,
  ): Promise<{ externalAgentId: string }> {
    // A scripted test uses a Retell Conversation Flow bound to the agent.
    let responseEngine: Record<string, unknown>;
    if (this.buildFlowConfig(spec)) {
      const cfRes = await this.fetchImpl(`${this.base}/create-conversation-flow`, {
        method: "POST",
        headers: this.headers(account),
        body: JSON.stringify(this.buildFlowConfig(spec)!),
      });
      if (!cfRes.ok) throw new Error(`Retell create-conversation-flow failed (${cfRes.status}): ${await safeText(cfRes)}`);
      const cf = (await cfRes.json()) as { conversation_flow_id: string };
      responseEngine = { type: "conversation-flow", conversation_flow_id: cf.conversation_flow_id };
    } else {
      const llmRes = await this.fetchImpl(`${this.base}/create-retell-llm`, {
        method: "POST",
        headers: this.headers(account),
        body: JSON.stringify(this.buildAgentConfig(spec)),
      });
      if (!llmRes.ok) throw new Error(`Retell create-retell-llm failed (${llmRes.status}): ${await safeText(llmRes)}`);
      const llm = (await llmRes.json()) as { llm_id: string };
      responseEngine = { type: "retell-llm", llm_id: llm.llm_id };
    }

    const agentRes = await this.fetchImpl(`${this.base}/create-agent`, {
      method: "POST",
      headers: this.headers(account),
      body: JSON.stringify({
        agent_name: spec.name,
        response_engine: responseEngine,
        voice_id: spec.voice ?? "11labs-Adrian",
      }),
    });
    if (!agentRes.ok) throw new Error(`Retell create-agent failed (${agentRes.status}): ${await safeText(agentRes)}`);
    const agent = (await agentRes.json()) as { agent_id: string };
    return { externalAgentId: agent.agent_id };
  }

  async getAgentVoice(account: ProviderAccount, externalAgentId: string): Promise<string | undefined> {
    const res = await this.fetchImpl(`${this.base}/get-agent/${encodeURIComponent(externalAgentId)}`, { headers: this.headers(account) });
    if (!res.ok) return undefined;
    const data = await res.json() as { voice_id?: string };
    return data.voice_id;
  }

  async listAvailableVoices(account: ProviderAccount): Promise<string[]> {
    const res = await this.fetchImpl(`${this.base}/list-voices`, { headers: this.headers(account) });
    if (!res.ok) throw new Error(`Retell could not list voices (${res.status}): ${await safeText(res)}`);
    const data = await res.json() as Array<{ voice_id?: string }> | { voices?: Array<{ voice_id?: string }> };
    return (Array.isArray(data) ? data : data.voices ?? []).map((voice) => voice.voice_id).filter((id): id is string => !!id);
  }

  async updateTestingAgent(account: ProviderAccount, agent: HostedTestingAgent, spec: TestingAgentSpec): Promise<void> {
    const graph = this.buildFlowConfig(spec);
    if (!graph) throw new Error("Retell needs scripted steps or a structured simulation to mold the selected tester. No call was placed.");
    const flowRes = await this.fetchImpl(`${this.base}/create-conversation-flow`, {
      method: "POST", headers: this.headers(account), body: JSON.stringify(graph),
    });
    if (!flowRes.ok) throw new Error(`Retell create-conversation-flow failed (${flowRes.status}): ${await safeText(flowRes)}`);
    const flow = (await flowRes.json()) as { conversation_flow_id?: string };
    if (!flow.conversation_flow_id) throw new Error("Retell returned no conversation_flow_id. No call was placed.");
    const getRes = await this.fetchImpl(`${this.base}/get-agent/${agent.externalAgentId}`, { headers: this.headers(account) });
    if (!getRes.ok) throw new Error(`Retell get-agent failed (${getRes.status}): ${await safeText(getRes)}`);
    const current = (await getRes.json()) as { version?: number; is_published?: boolean };
    if (current.version === undefined) throw new Error("Retell returned no agent version. No call was placed.");
    let version = current.version;
    if (current.is_published) {
      const draftRes = await this.fetchImpl(`${this.base}/create-agent-version/${agent.externalAgentId}`, {
        method: "POST", headers: this.headers(account), body: JSON.stringify({ base_version: version }),
      });
      if (!draftRes.ok) throw new Error(`Retell create-agent-version failed (${draftRes.status}): ${await safeText(draftRes)}`);
      const draft = (await draftRes.json()) as { version?: number };
      if (draft.version === undefined) throw new Error("Retell returned no draft version. No call was placed.");
      version = draft.version;
    }
    const updateRes = await this.fetchImpl(`${this.base}/update-agent/${agent.externalAgentId}?version=${version}`, {
      method: "PATCH", headers: this.headers(account),
      body: JSON.stringify({ response_engine: { type: "conversation-flow", conversation_flow_id: flow.conversation_flow_id }, ...(spec.voice ? { voice_id: spec.voice } : {}) }),
    });
    if (!updateRes.ok) throw new Error(`Retell update-agent failed (${updateRes.status}): ${await safeText(updateRes)}`);
    const publishRes = await this.fetchImpl(`${this.base}/publish-agent-version/${agent.externalAgentId}`, {
      method: "POST", headers: this.headers(account), body: JSON.stringify({ version }),
    });
    if (!publishRes.ok) throw new Error(`Retell publish-agent-version failed (${publishRes.status}): ${await safeText(publishRes)}`);
  }

  async placeCall(
    account: ProviderAccount,
    agent: HostedTestingAgent,
    target: HostedTarget,
  ): Promise<{ externalCallId: string }> {
    const res = await this.fetchImpl(`${this.base}/v2/create-phone-call`, {
      method: "POST",
      headers: this.headers(account),
      body: JSON.stringify({
        from_number: target.fromNumber || account.credentials.from,
        to_number: target.phoneNumber,
        override_agent_id: agent.externalAgentId,
        override_agent_version: "latest_published",
      }),
    });
    if (!res.ok) throw new Error(`Retell create-phone-call failed (${res.status}): ${await safeText(res)}`);
    const data = (await res.json()) as { call_id: string };
    return { externalCallId: data.call_id };
  }

  async getCall(account: ProviderAccount, externalCallId: string): Promise<HostedCallState> {
    const res = await this.fetchImpl(`${this.base}/v2/get-call/${externalCallId}`, {
      headers: this.headers(account),
    });
    if (!res.ok) throw new Error(`Retell get-call failed (${res.status}): ${await safeText(res)}`);
    const data = (await res.json()) as RetellCall;
    return {
      externalCallId,
      status: mapStatus(data.call_status),
      transcript: parseTranscript(data),
      endedReason: data.disconnection_reason,
    };
  }

  /**
   * List the account's existing Retell agents, so "My agents" can import one
   * instead of manual entry. GET /list-agents is the same endpoint
   * verifyCredentials probes.
   */
  async listRemoteAgents(account: ProviderAccount): Promise<HostedRemoteAgent[]> {
    const res = await this.fetchImpl(`${this.base}/list-agents`, { headers: this.headers(account) });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => null)) as unknown;
    const rows = Array.isArray(data) ? data : [];
    const out: HostedRemoteAgent[] = [];
    for (const r of rows as Array<Record<string, unknown>>) {
      const id = String(r.agent_id ?? "").trim();
      if (!id) continue;
      out.push({ id, name: String(r.agent_name ?? id).trim(), kind: "agent" });
    }
    return out;
  }
}

interface RetellTurn {
  role?: string;
  content?: string;
}
interface RetellCall {
  call_status?: string;
  disconnection_reason?: string;
  transcript_object?: RetellTurn[];
}

function mapStatus(status?: string): HostedCallStatus {
  switch (status) {
    case "registered":
    case "not_connected":
      return "queued";
    case "ongoing":
      return "in-progress";
    case "ended":
      return "ended";
    case "error":
      return "failed";
    default:
      return status ? "in-progress" : "queued";
  }
}

/** Retell "agent" is our tester (agent); "user" is the target under test. */
function parseTranscript(call: RetellCall): Transcript | undefined {
  if (!call.transcript_object?.length) return undefined;
  const base = Date.now();
  const out: Transcript = [];
  for (const t of call.transcript_object) {
    const text = (t.content ?? "").trim();
    if (!text) continue;
    out.push({ role: t.role?.toLowerCase() === "user" ? "target" : "agent", text, startedAt: base });
  }
  return out.length ? out : undefined;
}
