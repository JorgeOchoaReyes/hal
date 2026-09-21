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
import { structuredToSteps } from "../../simulation/structured.js";

/**
 * Bland AI integration.
 *
 * Bland places outbound calls with an inline `task` (the agent's instructions)
 * rather than always referencing a persisted agent, which makes it a strong fit
 * for deterministic, scripted tests. We still create a persistent Bland agent so
 * it can be reused, but we keep the spec on the HAL agent record and send the
 * prompt as the call `task` at run time so calls work regardless.
 *
 * Auth: Bland uses the raw API key in the Authorization header (no "Bearer").
 * `fetchImpl` is injectable for unit tests.
 */
export class BlandIntegration implements VoiceProviderIntegration {
  readonly id = "bland";
  readonly label = "Bland AI";
  readonly credentialFields: ProviderField[] = [
    { key: "apiKey", label: "Bland API key", required: true },
    {
      key: "from",
      label: "From number (optional)",
      help: "A Bland number to call from. Leave blank to use Bland's default pool.",
    },
  ];

  private readonly base: string;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    baseUrl = "https://api.bland.ai",
  ) {
    this.base = baseUrl.replace(/\/$/, "");
  }

  private headers(account: ProviderAccount): Record<string, string> {
    return {
      authorization: account.credentials.apiKey ?? "",
      "content-type": "application/json",
    };
  }

  /** Native Bland agent body. Steps are also attached for traceability. */
  buildAgentConfig(spec: TestingAgentSpec): Record<string, unknown> {
    const { systemPrompt, firstMessage } = resolveSpecPrompt(spec);
    return {
      prompt: systemPrompt,
      first_sentence: firstMessage,
      voice: spec.voice,
      model: spec.model,
      ...(spec.structured ? { metadata: { hal_steps: structuredToSteps(spec.structured) } } : {}),
    };
  }

  async createTestingAgent(
    account: ProviderAccount,
    spec: TestingAgentSpec,
  ): Promise<{ externalAgentId: string }> {
    // Best-effort: register a persistent Bland agent. If the endpoint shape
    // differs, the caller still keeps the spec and can place task-based calls.
    const res = await this.fetchImpl(`${this.base}/v1/agents`, {
      method: "POST",
      headers: this.headers(account),
      body: JSON.stringify(this.buildAgentConfig(spec)),
    });
    if (!res.ok) throw new Error(`Bland createAgent failed (${res.status}): ${await safeText(res)}`);
    const data = (await res.json()) as { agent?: { agent_id?: string }; agent_id?: string };
    const agentId = data.agent?.agent_id ?? data.agent_id;
    if (!agentId) throw new Error("Bland createAgent returned no agent id");
    return { externalAgentId: agentId };
  }

  async placeCall(
    account: ProviderAccount,
    agent: HostedTestingAgent,
    target: HostedTarget,
  ): Promise<{ externalCallId: string }> {
    const resolved = agent.spec
      ? resolveSpecPrompt(agent.spec)
      : { systemPrompt: "You are a QA tester calling to evaluate a voice AI.", firstMessage: undefined };
    const res = await this.fetchImpl(`${this.base}/v1/calls`, {
      method: "POST",
      headers: this.headers(account),
      body: JSON.stringify({
        phone_number: target.phoneNumber,
        task: resolved.systemPrompt,
        first_sentence: resolved.firstMessage,
        voice: agent.spec?.voice,
        ...(account.credentials.from ? { from: account.credentials.from } : {}),
        wait_for_greeting: true,
      }),
    });
    if (!res.ok) throw new Error(`Bland send-call failed (${res.status}): ${await safeText(res)}`);
    const data = (await res.json()) as { call_id?: string; callId?: string };
    const callId = data.call_id ?? data.callId;
    if (!callId) throw new Error("Bland send-call returned no call id");
    return { externalCallId: callId };
  }

  async getCall(account: ProviderAccount, externalCallId: string): Promise<HostedCallState> {
    const res = await this.fetchImpl(`${this.base}/v1/calls/${externalCallId}`, {
      headers: this.headers(account),
    });
    if (!res.ok) throw new Error(`Bland getCall failed (${res.status}): ${await safeText(res)}`);
    const data = (await res.json()) as BlandCall;
    return {
      externalCallId,
      status: mapStatus(data),
      transcript: parseTranscript(data),
      endedReason: data.error_message ?? undefined,
    };
  }
}

interface BlandTurn {
  user?: string; // "assistant" | "user" | "agent"
  text?: string;
}
interface BlandCall {
  status?: string;
  completed?: boolean;
  error_message?: string;
  transcripts?: BlandTurn[];
}

function mapStatus(call: BlandCall): HostedCallStatus {
  if (call.completed) return "ended";
  switch (call.status) {
    case "queued":
    case "ringing":
      return "queued";
    case "in-progress":
    case "started":
      return "in-progress";
    case "completed":
      return "ended";
    case "failed":
    case "no-answer":
    case "busy":
    case "error":
      return "failed";
    default:
      return call.status ? "in-progress" : "queued";
  }
}

/** Bland labels the AI "assistant" (our tester → agent) and the human "user" (the target). */
function parseTranscript(call: BlandCall): Transcript | undefined {
  if (!call.transcripts?.length) return undefined;
  const base = Date.now();
  const out: Transcript = [];
  for (const t of call.transcripts) {
    const text = (t.text ?? "").trim();
    if (!text) continue;
    const who = t.user?.toLowerCase();
    out.push({ role: who === "user" || who === "human" ? "target" : "agent", text, startedAt: base });
  }
  return out.length ? out : undefined;
}
