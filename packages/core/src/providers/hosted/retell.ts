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
  FetchLike,
  safeText,
  resolveSpecPrompt,
} from "./integration.js";
import { structuredToFlow, toRetellConversationFlow } from "../../simulation/flow.js";

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

  private readonly base: string;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    baseUrl = "https://api.retellai.com",
  ) {
    this.base = baseUrl.replace(/\/$/, "");
  }

  private headers(account: ProviderAccount): Record<string, string> {
    return {
      authorization: `Bearer ${account.credentials.apiKey ?? ""}`,
      "content-type": "application/json",
    };
  }

  buildFlowConfig(spec: TestingAgentSpec): Record<string, unknown> | null {
    return spec.structured
      ? toRetellConversationFlow(structuredToFlow(spec.structured), spec.name)
      : null;
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
    // Node-native: a structured test becomes a Retell Conversation Flow; the
    // agent is bound to it. Otherwise a Retell LLM carries the compiled prompt.
    let responseEngine: Record<string, unknown>;
    if (spec.structured) {
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

  async placeCall(
    account: ProviderAccount,
    agent: HostedTestingAgent,
    target: HostedTarget,
  ): Promise<{ externalCallId: string }> {
    const res = await this.fetchImpl(`${this.base}/v2/create-phone-call`, {
      method: "POST",
      headers: this.headers(account),
      body: JSON.stringify({
        from_number: account.credentials.from,
        to_number: target.phoneNumber,
        override_agent_id: agent.externalAgentId,
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
