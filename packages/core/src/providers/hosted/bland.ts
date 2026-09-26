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
  HostedRemoteAgent,
  OutboundAgentRef,
  FetchLike,
  CredentialCheck,
  safeText,
  resolveSpecPrompt,
  withTimeout,
} from "./integration.js";
import { structuredToSteps } from "../../simulation/structured.js";
import { stepsToFlow, structuredToFlow, toBlandPathway } from "../../simulation/flow.js";

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
      help: "Caller ID owned by this Bland account, with country code (e.g. +14155550123). Leave blank for Bland’s default pool.",
    },
    { key: "encryptedKey", label: "Twilio encrypted key (optional)", help: "For your own Twilio caller ID: use the matching BYOT encrypted key from Bland." },
  ];

  private readonly fetchImpl: FetchLike;
  private readonly base: string;
  private readonly recordingFetch: FetchLike;

  constructor(fetchImpl: FetchLike = fetch, baseUrl = "https://api.bland.ai") {
    this.fetchImpl = withTimeout(fetchImpl);
    this.recordingFetch = fetchImpl;
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
      : spec.steps?.length ? toBlandPathway(stepsToFlow(spec.steps, spec.persona.systemPrompt), spec.name) : null;
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
   * graph), following Bland's documented V1 lifecycle:
   *   1. POST /v1/pathway/create              → get a pathway id
   *   2. POST /v1/pathway/{id}                → set the node/edge graph
   *   3. POST /v1/pathway/{id}/version        → snapshot a version (best-effort)
   *   4. POST /v1/pathway/{id}/publish        → promote it to production (best-effort)
   * The version/publish steps make the call run a stable graph; a call by
   * pathway_id still works without them, so a failure there doesn't fail
   * provisioning. Creating a pathway places no call and costs nothing.
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

    // 1) Create the pathway shell (POST /v1/pathway/create).
    const createRes = await this.post(account, "/v1/pathway/create", { name, description });
    const createText = await safeText(createRes);
    if (!createRes.ok) {
      throw new Error(`Bland create pathway failed (${createRes.status}): ${createText.slice(0, 200)}`);
    }
    let pathwayId: string | undefined;
    try {
      const d = JSON.parse(createText) as Record<string, unknown> & { data?: Record<string, unknown> };
      pathwayId = String(d.pathway_id ?? d.id ?? d.data?.pathway_id ?? d.data?.id ?? "") || undefined;
    } catch {
      /* fallthrough */
    }
    if (!pathwayId) {
      throw new Error(`Bland create pathway returned no id: ${createText.slice(0, 200)}`);
    }

    // 2) Set the node/edge graph (POST /v1/pathway/{id}).
    const graphBody = { name, description, nodes: graph.nodes, edges: graph.edges };
    const updateRes = await this.post(account, `/v1/pathway/${pathwayId}`, graphBody);
    const updateText = await safeText(updateRes);
    let updateFailed = !updateRes.ok;
    try { updateFailed ||= JSON.parse(updateText).status === "error"; } catch { /* HTTP status remains authoritative */ }
    if (updateFailed) {
      throw new Error(
        `Bland pathway ${pathwayId} created but setting nodes/edges failed (${updateRes.status}): ${updateText.slice(0, 200)}`,
      );
    }

    // 3) Best-effort: snapshot a version and promote it to production so the
    //    test call runs a stable graph. A call by pathway_id works without it.
    try {
      const verRes = await this.post(account, `/v1/pathway/${pathwayId}/version`, {
        name,
        nodes: graph.nodes,
        edges: graph.edges,
      });
      if (verRes.ok) {
        const vd = JSON.parse(await safeText(verRes)) as Record<string, unknown> & {
          data?: Record<string, unknown>;
        };
        const versionId =
          vd.version_number ?? vd.version_id ?? vd.data?.version_number ?? vd.data?.version_id;
        if (versionId != null) {
          await this.post(account, `/v1/pathway/${pathwayId}/publish`, {
            version_id: versionId,
            environment: "production",
          });
        }
      }
    } catch {
      /* the dev version is fine for a test call */
    }

    return pathwayId;
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

    // Compile a structured test into a Bland Pathway via the documented V1
    // pathway lifecycle. The returned pathway id is used to place the call.
    if (spec.structured || spec.steps?.length) {
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

  async getInboundPathway(account: ProviderAccount, phoneNumber: string): Promise<string | undefined> {
    const res = await this.fetchImpl(`${this.base}/v1/inbound/${encodeURIComponent(phoneNumber)}`, { headers: this.headers(account) });
    if (!res.ok) return undefined;
    const data = await res.json() as { pathway_id?: unknown };
    return typeof data.pathway_id === "string" && data.pathway_id.trim() ? data.pathway_id.trim() : undefined;
  }

  async configureInbound(account: ProviderAccount, agent: HostedTestingAgent, phoneNumber: string): Promise<void> {
    if (!agent.spec?.structured && !agent.spec?.steps?.length && !agent.spec?.pathwayId) {
      throw new Error("Inbound Bland testing requires a structured simulation/pathway. Select a structured simulation so HAL can assign its pathway to the dedicated test number.");
    }
    const res = await this.post(account, `/v1/inbound/${encodeURIComponent(phoneNumber)}`, {
      pathway_id: agent.externalAgentId,
    });
    const detail = await safeText(res);
    let failed = !res.ok;
    try { failed ||= JSON.parse(detail).status === "error"; } catch { /* HTTP status remains authoritative */ }
    if (failed) throw new Error(`Bland could not configure inbound test number ${phoneNumber} on account "${account.label}" (${res.status}). Confirm this account owns the number. No call was placed.`);
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
    const from = callerId(account, target);
    const body = agent.spec?.structured || agent.spec?.steps?.length || agent.spec?.pathwayId
      ? {
          record: true,
          phone_number: target.phoneNumber,
          pathway_id: agent.externalAgentId,
          ...(from ? { from } : {}),
        }
      : {
          record: true,
          phone_number: target.phoneNumber,
          task: resolved.systemPrompt,
          first_sentence: resolved.firstMessage,
          voice: agent.spec?.voice,
          ...(from ? { from } : {}),
          wait_for_greeting: true,
        };
    const res = await this.fetchImpl(`${this.base}/v1/calls`, {
      method: "POST",
      headers: { ...this.headers(account), ...byotHeaders(agent.encryptedKey || account.credentials.encryptedKey) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await callError(res, account, target);
    const data = (await res.json()) as { call_id?: string; callId?: string };
    const callId = data.call_id ?? data.callId;
    if (!callId) throw new Error("Bland send-call returned no call id");
    return { externalCallId: callId };
  }

  /**
   * Trigger an outbound call from ANOTHER agent's own Bland Pathway (the
   * agent under test, when it's the one placing the call) to a target
   * number — same `/v1/calls` endpoint as {@link placeCall}, but scoped to
   * that pathway. BYOT encrypted keys are sent in the encrypted_key header.
   * See https://docs.bland.ai/api-v1/post/calls.
   */
  async placeOutboundCall(
    account: ProviderAccount,
    outbound: OutboundAgentRef,
    target: HostedTarget,
  ): Promise<{ externalCallId: string }> {
    const from = callerId(account, target);
    const body: Record<string, unknown> = {
      record: true,
      phone_number: target.phoneNumber,
      pathway_id: outbound.externalAgentId,
      ...(from ? { from } : {}),

    };
    const res = await this.fetchImpl(`${this.base}/v1/calls`, {
      method: "POST",
      headers: { ...this.headers(account), ...byotHeaders(outbound.encryptedKey || account.credentials.encryptedKey) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await callError(res, account, target);
    const data = (await res.json()) as { call_id?: string; callId?: string };
    const callId = data.call_id ?? data.callId;
    if (!callId) throw new Error("Bland outbound dispatch returned no call id");
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

  /**
   * List the account's Bland Pathways so the UI can offer them for import
   * (GET /v1/pathway). The response envelope varies (a bare array, a `data`
   * array, or a single object), so we normalize defensively and skip rows with
   * no id. Returns an empty list on any non-OK response.
   */
  async listRemoteAgents(account: ProviderAccount): Promise<HostedRemoteAgent[]> {
    const res = await this.fetchImpl(`${this.base}/v1/pathway`, { headers: this.headers(account) });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => null)) as unknown;
    const raw = (data && typeof data === "object" && "data" in data
      ? (data as { data: unknown }).data
      : data) as unknown;
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const out: HostedRemoteAgent[] = [];
    for (const r of rows as Array<Record<string, unknown>>) {
      if (!r || typeof r !== "object") continue;
      const id = String(r.id ?? r.pathway_id ?? r._id ?? "").trim();
      if (!id) continue;
      const name = String(r.name ?? r.pathway_name ?? id).trim();
      out.push({ id, name, kind: "pathway" });
    }
    return out;
  }

  async getRecording(account: ProviderAccount, externalCallId: string): Promise<Response> {
    // Fixed authenticated API endpoint; never fetch a user-supplied URL.
    return this.recordingFetch(`${this.base}/v1/recordings/${encodeURIComponent(externalCallId)}`, {
      headers: { ...this.headers(account), "content-type": "audio/mpeg", accept: "audio/mpeg" },
      signal: AbortSignal.timeout(60_000),
      redirect: "error",
    });
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

function byotHeaders(key?: string): Record<string, string> {
  return key?.trim() ? { encrypted_key: key.trim() } : {};
}

function callerId(account: ProviderAccount, target: HostedTarget): string | undefined {
  // Explicit empty string disables the account default; undefined retains it.
  const raw = target.fromNumber === undefined ? account.credentials.from : target.fromNumber;
  const from = raw?.trim().replace(/[\s().-]/g, "");
  if (!from) return undefined;
  if (!/^\+[1-9]\d{7,14}$/.test(from)) {
    throw new Error(`Invalid outbound caller ID (from) "${raw}" for Bland account "${account.label}". Include + and the country code, e.g. +14155550123. ${target.fromNumber === undefined ? "Correct the account’s From number or choose Bland default pool in dispatch." : "Correct the outbound caller ID field or choose Bland default pool."}`);
  }
  return from;
}

async function callError(res: Response, account: ProviderAccount, target: HostedTarget): Promise<Error> {
  const raw = await safeText(res);
  let message = raw;
  try { message = JSON.parse(raw).message ?? raw; } catch { /* plain provider response */ }
  if (/invalid.*["'`]from["'`]|not own this number/i.test(message)) {
    const source = target.fromNumber === undefined ? "provider account’s From number" : "dispatch’s outbound caller ID";
    return new Error(`Bland rejected outbound caller ID (from) "${callerId(account, target) ?? "default pool"}" from the ${source} for account "${account.label}" (HTTP ${res.status}). Use a number owned by this Bland account, with + and country code. For a Twilio number, enter its matching key in dispatch’s Twilio BYOT encrypted key field, or configure it on the outbound agent or account. Or select Bland default pool to omit from. The inbound destination is a separate field. No call was placed.`);
  }
  return new Error(`Bland send-call failed (HTTP ${res.status}) on account "${account.label}". Check the provider dashboard for details.`);
}
