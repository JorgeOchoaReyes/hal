import { Transcript } from "../../types.js";
import { ProviderField } from "../templates.js";
import { structuredToFlow, toElevenLabsWorkflow } from "../../simulation/flow.js";
import {
  VoiceProviderIntegration,
  ProviderAccount,
  TestingAgentSpec,
  HostedTestingAgent,
  HostedTarget,
  HostedCallState,
  HostedCallStatus,
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
    return spec.structured
      ? toElevenLabsWorkflow(structuredToFlow(spec.structured), spec.name)
      : null;
  }

  /** Native ElevenLabs ConvAI agent body — deterministic reproduction of the spec. */
  buildAgentConfig(spec: TestingAgentSpec): Record<string, unknown> {
    const { systemPrompt, firstMessage } = resolveSpecPrompt(spec);
    const agent: Record<string, unknown> = {
      prompt: { prompt: systemPrompt },
      first_message: firstMessage ?? "Hello.",
    };
    // Node-native: embed the compiled workflow graph when a structured test.
    if (spec.structured) {
      const flow = this.buildFlowConfig(spec) as { workflow?: unknown } | null;
      if (flow?.workflow) agent.workflow = flow.workflow;
    }
    return { name: spec.name, conversation_config: { agent } };
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
    };
  }
}

interface ElevenTurn {
  role?: string;
  message?: string;
  text?: string;
  time_in_call_secs?: number;
}
interface ElevenConversation {
  status?: string;
  transcript?: ElevenTurn[];
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
  const base = Date.now();
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
    });
  }
  return out.length ? out : undefined;
}
