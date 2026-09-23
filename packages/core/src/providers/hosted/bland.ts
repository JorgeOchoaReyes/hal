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
  HostedNumber,
  FetchLike,
  CredentialCheck,
  safeText,
  resolveSpecPrompt,
  withTimeout,
} from "./integration.js";
import { structuredToSteps } from "../../simulation/structured.js";
import { structuredToFlow, toBlandPathway } from "../../simulation/flow.js";

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

  private readonly fetchImpl: FetchLike;
  private readonly base: string;

  constructor(fetchImpl: FetchLike = fetch, baseUrl = "https://api.bland.ai") {
    this.fetchImpl = withTimeout(fetchImpl);
    this.base = baseUrl.replace(/\/$/, "");
  }

  private headers(account: ProviderAccount): Record<string, string> {
    return {
      authorization: account.credentials.apiKey ?? "",
      "content-type": "application/json",
    };
  }

  async verifyCredentials(account: ProviderAccount): Promise<CredentialCheck> {
    try {
      const res = await this.fetchImpl(`${this.base}/v1/me`, { headers: this.headers(account) });
      if (res.ok) return { ok: true };
      // Only an explicit auth rejection means the key is bad. Bland doesn't
      // expose /v1/me on every plan, so a 404/405/5xx just means the probe
      // endpoint isn't available — don't report a valid key as invalid.
      if (res.status === 401 || res.status === 403) {
        return { ok: false, detail: `${res.status}: ${(await safeText(res)).slice(0, 200)}` };
      }
      return { ok: true, detail: `Key accepted (verify endpoint returned ${res.status}).` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  buildFlowConfig(spec: TestingAgentSpec): Record<string, unknown> | null {
    return spec.structured
      ? toBlandPathway(structuredToFlow(spec.structured), spec.name)
      : null;
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
    // Node-native: a structured test becomes a Bland Pathway. The returned
    // pathway id is used to place the call (deterministic node graph).
    if (spec.structured) {
      const pathway = this.buildFlowConfig(spec)!;
      const res = await this.fetchImpl(`${this.base}/v1/pathway`, {
        method: "POST",
        headers: this.headers(account),
        body: JSON.stringify(pathway),
      });
      if (!res.ok) throw new Error(`Bland createPathway failed (${res.status}): ${await safeText(res)}`);
      const data = (await res.json()) as { pathway_id?: string; id?: string };
      const pathwayId = data.pathway_id ?? data.id;
      if (!pathwayId) throw new Error("Bland createPathway returned no pathway id");
      return { externalAgentId: pathwayId };
    }

    // Prompt mode: register a persistent Bland agent.
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
    // Node-native pathway call when the agent was built from a structured test.
    const body = agent.spec?.structured
      ? {
          phone_number: target.phoneNumber,
          pathway_id: agent.externalAgentId,
          ...(account.credentials.from ? { from: account.credentials.from } : {}),
        }
      : {
          phone_number: target.phoneNumber,
          task: resolved.systemPrompt,
          first_sentence: resolved.firstMessage,
          voice: agent.spec?.voice,
          ...(account.credentials.from ? { from: account.credentials.from } : {}),
          wait_for_greeting: true,
        };
    const res = await this.fetchImpl(`${this.base}/v1/calls`, {
      method: "POST",
      headers: this.headers(account),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Bland send-call failed (${res.status}): ${await safeText(res)}`);
    const data = (await res.json()) as { call_id?: string; callId?: string };
    const callId = data.call_id ?? data.callId;
    if (!callId) throw new Error("Bland send-call returned no call id");
    return { externalCallId: callId };
  }

  /**
   * List the account's purchased Bland numbers so the UI can offer a picker.
   * Bland numbers are usable both as the inbound target of a Bland agent and as
   * the outbound caller id, so both capabilities are reported.
   *
   * Endpoint shape is modeled from Bland's public API and parsed defensively;
   * on any non-OK response we return an empty list so the UI falls back to
   * manual entry rather than erroring.
   */
  async listNumbers(account: ProviderAccount): Promise<HostedNumber[]> {
    const res = await this.fetchImpl(`${this.base}/v1/inbound`, {
      headers: this.headers(account),
    });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => null)) as unknown;
    const rows = extractNumberRows(data);
    const out: HostedNumber[] = [];
    for (const row of rows) {
      const phoneNumber = String(
        row.phone_number ?? row.number ?? row.phoneNumber ?? "",
      ).trim();
      if (!phoneNumber) continue;
      const label = row.name ?? row.label ?? row.location ?? undefined;
      out.push({
        phoneNumber,
        label: label ? String(label) : undefined,
        capabilities: ["inbound", "outbound"],
      });
    }
    return out;
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
  speaker?: string; // some responses use "speaker": "ai" | "human"
  role?: string;
  text?: string;
}
interface BlandCall {
  status?: string;
  completed?: boolean;
  error_message?: string;
  transcripts?: BlandTurn[];
}

type NumberRow = Record<string, unknown> & {
  phone_number?: unknown;
  number?: unknown;
  phoneNumber?: unknown;
  name?: unknown;
  label?: unknown;
  location?: unknown;
};

/** Pull the array of number records out of Bland's response, whatever its shape. */
function extractNumberRows(data: unknown): NumberRow[] {
  if (Array.isArray(data)) return data as NumberRow[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["inbound_numbers", "numbers", "data", "inbound"]) {
      if (Array.isArray(obj[key])) return obj[key] as NumberRow[];
    }
  }
  return [];
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

/**
 * Bland labels the AI (our tester → `agent`) and the human/other party (the
 * target under test). Different Bland responses use different keys/values for
 * the speaker — `user: "assistant"|"user"`, `speaker: "ai"|"human"`, or `role` —
 * so we read whichever is present and map the human side to `target`. Mislabeling
 * would make the judge see only one side of the call.
 */
function parseTranscript(call: BlandCall): Transcript | undefined {
  if (!call.transcripts?.length) return undefined;
  const base = Date.now();
  const out: Transcript = [];
  for (const t of call.transcripts) {
    const text = (t.text ?? "").trim();
    if (!text) continue;
    const who = (t.user ?? t.speaker ?? t.role ?? "").toLowerCase();
    const isHuman = who === "user" || who === "human" || who === "customer" || who === "target";
    out.push({ role: isHuman ? "target" : "agent", text, startedAt: base });
  }
  return out.length ? out : undefined;
}
