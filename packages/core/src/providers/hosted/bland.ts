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
 * Auth: Bland's current API recommends `Authorization: Bearer <key>` (it also
 * accepts a bare key for older examples, but the Send Call endpoint does not
 * accept `x-api-key`). A key already prefixed with "Bearer " is passed through.
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
    const key = (account.credentials.apiKey ?? "").trim();
    return {
      authorization: key && !/^bearer\s/i.test(key) ? `Bearer ${key}` : key,
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

  private post(account: ProviderAccount, path: string, body: unknown): ReturnType<FetchLike> {
    return this.fetchImpl(`${this.base}${path}`, {
      method: "POST",
      headers: this.headers(account),
      body: JSON.stringify(body),
    });
  }

  /**
   * Provision a Bland Pathway from a structured test (a deterministic node
   * graph). Bland has shipped more than one pathway API shape over time
   * (a single-shot create, and a create-then-set-version flow), so we create
   * the pathway shell, then set its nodes/edges, trying the documented endpoint
   * variants and surfacing every attempt's response if it fails. Creating a
   * pathway places no call and costs nothing.
   */
  private async provisionPathway(
    account: ProviderAccount,
    spec: TestingAgentSpec,
  ): Promise<string> {
    const graph = this.buildFlowConfig(spec)! as {
      name?: string;
      nodes: unknown[];
      edges: unknown[];
    };
    const name = spec.name || "HAL test";
    const description = "Provisioned by HAL for a deterministic voice test.";
    const attempts: string[] = [];

    // 1) Create the pathway shell to get an id.
    let pathwayId: string | undefined;
    for (const path of ["/v1/pathway/create", "/v1/pathways"]) {
      const res = await this.post(account, path, { name, description });
      const text = await safeText(res);
      if (res.ok) {
        try {
          const d = JSON.parse(text) as Record<string, unknown> & { data?: Record<string, unknown> };
          pathwayId = String(
            d.pathway_id ?? d.id ?? d.data?.pathway_id ?? d.data?.id ?? "",
          ) || undefined;
        } catch {
          /* fallthrough */
        }
        if (pathwayId) break;
        attempts.push(`POST ${path} → ${res.status} but no pathway id in ${text.slice(0, 160)}`);
      } else {
        attempts.push(`POST ${path} → ${res.status}: ${text.slice(0, 160)}`);
      }
    }
    if (!pathwayId) {
      throw new Error(`Bland create pathway failed. Attempts: ${attempts.join(" | ")}`);
    }

    // 2) Set the node graph on the pathway (documented variants).
    const graphBody = { name, nodes: graph.nodes, edges: graph.edges };
    for (const path of [`/v1/pathway/${pathwayId}`, `/v1/pathway/${pathwayId}/version`]) {
      const res = await this.post(account, path, graphBody);
      if (res.ok) return pathwayId;
      attempts.push(`update ${path} → ${res.status}: ${(await safeText(res)).slice(0, 160)}`);
    }
    throw new Error(
      `Bland pathway ${pathwayId} was created but setting its nodes/edges failed. Attempts: ${attempts.join(" | ")}`,
    );
  }

  async createTestingAgent(
    account: ProviderAccount,
    spec: TestingAgentSpec,
  ): Promise<{ externalAgentId: string }> {
    // Preferred: an existing Bland Pathway id (built in the Agent Builder).
    // Bland has no documented REST endpoint to create a pathway, so supplying
    // the id is the reliable way to run a deterministic pathway.
    if (spec.pathwayId?.trim()) {
      return { externalAgentId: spec.pathwayId.trim() };
    }

    // Best-effort: compile a structured test into a Bland Pathway. The returned
    // pathway id is used to place the call. (Uses undocumented create endpoints,
    // so it may fail on some plans — prefer supplying a pathwayId above.)
    if (spec.structured) {
      return { externalAgentId: await this.provisionPathway(account, spec) };
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
    // Pathway call when the agent is pathway-based (a supplied pathway id or a
    // compiled structured test). The pathway id lives on externalAgentId.
    const body = agent.spec?.structured || agent.spec?.pathwayId
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
