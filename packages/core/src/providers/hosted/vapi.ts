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

  private readonly base: string;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    baseUrl = "https://api.vapi.ai",
  ) {
    this.base = baseUrl.replace(/\/$/, "");
  }

  private headers(account: ProviderAccount): Record<string, string> {
    return {
      authorization: `Bearer ${account.credentials.apiKey ?? ""}`,
      "content-type": "application/json",
    };
  }

  async createTestingAgent(
    account: ProviderAccount,
    spec: TestingAgentSpec,
  ): Promise<{ externalAgentId: string }> {
    const res = await this.fetchImpl(`${this.base}/assistant`, {
      method: "POST",
      headers: this.headers(account),
      body: JSON.stringify({
        name: spec.name,
        firstMessage: spec.firstMessage ?? "Hello.",
        model: {
          provider: "openai",
          model: spec.model ?? "gpt-4o-mini",
          messages: [{ role: "system", content: spec.persona.systemPrompt }],
        },
        ...(spec.voice ? { voice: { provider: "vapi", voiceId: spec.voice } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Vapi createAssistant failed (${res.status}): ${await safeText(res)}`);
    const data = (await res.json()) as { id: string };
    return { externalAgentId: data.id };
  }

  async placeCall(
    account: ProviderAccount,
    agent: HostedTestingAgent,
    target: HostedTarget,
  ): Promise<{ externalCallId: string }> {
    const res = await this.fetchImpl(`${this.base}/call`, {
      method: "POST",
      headers: this.headers(account),
      body: JSON.stringify({
        assistantId: agent.externalAgentId,
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
      endedReason: data.endedReason,
    };
  }
}

interface VapiMessage {
  role?: string;
  message?: string;
  content?: string;
  time?: number;
  secondsFromStart?: number;
}
interface VapiCall {
  status?: string;
  endedReason?: string;
  transcript?: string;
  messages?: VapiMessage[];
  artifact?: { messages?: VapiMessage[] };
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
  const msgs = call.messages ?? call.artifact?.messages;
  if (!msgs || msgs.length === 0) return undefined;
  const base = Date.now();
  const out: Transcript = [];
  for (const m of msgs) {
    const role = m.role?.toLowerCase();
    if (role !== "user" && role !== "bot" && role !== "assistant") continue; // skip system/tool
    const text = (m.message ?? m.content ?? "").trim();
    if (!text) continue;
    out.push({
      role: role === "user" ? "target" : "agent",
      text,
      startedAt: m.time ?? base + (m.secondsFromStart ?? 0) * 1000,
    });
  }
  return out.length ? out : undefined;
}
