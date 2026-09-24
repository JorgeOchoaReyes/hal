import "server-only";
import { join } from "node:path";
import {
  HalEngine,
  providerAvailability,
  type TestCase,
  type TestResult,
  type ProviderAvailability,
  type ProviderAccount,
  type HostedTestingAgent,
  type TargetAgent,
  type SavedJudge,
  type JudgeSpec,
  type ProdCall,
} from "@hal/core";
import { MediaServer, MediaGateway } from "@hal/media";
import { createPersistence, type Persistence } from "./persistence";
import { encryptCredentials, decryptCredentials } from "./secretbox";

/**
 * Process-wide state, persisted via the {@link Persistence} layer (SQLite by
 * default, JSON fallback) under `HAL_DATA_DIR`. In-memory Maps are the working
 * copy; every mutation writes through to the store.
 *
 * Stored on globalThis so Next.js dev hot-reload doesn't wipe state.
 */
interface HalState {
  db: Persistence;
  testCases: Map<string, TestCase>;
  results: Map<string, TestResult>;
  accounts: Map<string, ProviderAccount>;
  agents: Map<string, HostedTestingAgent>;
  targets: Map<string, TargetAgent>;
  judges: Map<string, SavedJudge>;
  prodCalls: Map<string, ProdCall>;
  engine: HalEngine;
  mediaServer?: MediaServer;
  mediaGateway?: MediaGateway;
}

declare global {
  // eslint-disable-next-line no-var
  var __hal__: HalState | undefined;
}

const DATA_DIR = process.env.HAL_DATA_DIR ?? join(process.cwd(), "data");

// Snapshot the environment as it was at process start, so real (deployment) env
// vars always win over UI-stored secrets and we can tell the two apart.
const REAL_ENV: Record<string, string | undefined> = { ...process.env };

function seed(): HalState {
  const db = createPersistence(DATA_DIR);
  // Apply UI-stored secrets to process.env before anything reads them.
  applySecrets(loadSecretsDoc(db));

  const testCases = new Map<string, TestCase>();
  for (const tc of db.loadAll<TestCase>("testcases")) testCases.set(tc.id, tc);

  const results = new Map<string, TestResult>();
  for (const r of db.loadAll<TestResult>("results")) results.set(r.id, r);
  const accounts = new Map<string, ProviderAccount>();
  // Credentials are stored encrypted at rest; decrypt into memory for use.
  for (const a of db.loadAll<ProviderAccount>("accounts"))
    accounts.set(a.id, { ...a, credentials: decryptCredentials(a.credentials) });
  const agents = new Map<string, HostedTestingAgent>();
  for (const a of db.loadAll<HostedTestingAgent>("agents")) agents.set(a.id, a);
  const judges = new Map<string, SavedJudge>();
  for (const j of db.loadAll<SavedJudge>("judges")) judges.set(j.id, j);
  const prodCalls = new Map<string, ProdCall>();
  for (const p of db.loadAll<ProdCall>("prodcalls")) prodCalls.set(p.id, p);

  // "My agents" — the real targets under test.
  const targets = new Map<string, TargetAgent>();
  for (const t of db.loadAll<TargetAgent>("targets")) targets.set(t.id, t);

  // Start a media server for real telephony audio when Twilio is configured.
  let mediaServer: MediaServer | undefined;
  const telephonyReady =
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER;
  if (telephonyReady) {
    mediaServer = new MediaServer({ publicUrl: process.env.HAL_PUBLIC_URL });
    mediaServer
      .listen(Number(process.env.HAL_MEDIA_PORT ?? 8787))
      // eslint-disable-next-line no-console
      .then(() => console.log("[hal] media server started for telephony"))
      // eslint-disable-next-line no-console
      .catch((err) => console.warn("[hal] media server failed to start", err));
  }

  // Start a WebRTC/SIP media gateway when a speech provider is configured.
  // Both transports share one vendor-neutral WebSocket audio plane.
  let mediaGateway: MediaGateway | undefined;
  if (process.env.DEEPGRAM_API_KEY && process.env.HAL_MEDIA_GATEWAY !== "off") {
    mediaGateway = new MediaGateway();
    mediaGateway
      .listen(Number(process.env.HAL_GATEWAY_PORT ?? 8788))
      // eslint-disable-next-line no-console
      .then(() => console.log("[hal] media gateway started for webrtc/sip"))
      // eslint-disable-next-line no-console
      .catch((err) => console.warn("[hal] media gateway failed to start", err));
  }

  const engine = new HalEngine({
    telephony: { config: {}, bridgeFactory: mediaServer?.bridgeFactory },
    webrtc: { bridgeFactory: mediaGateway?.webrtcBridgeFactory },
    sip: { bridgeFactory: mediaGateway?.sipBridgeFactory },
  });

  // eslint-disable-next-line no-console
  console.log(`[hal] persistence backend: ${db.backend}`);
  return { db, testCases, results, accounts, agents, targets, judges, prodCalls, engine, mediaServer, mediaGateway };
}

export function halState(): HalState {
  if (!globalThis.__hal__) globalThis.__hal__ = seed();
  return globalThis.__hal__;
}

export function listTestCases(): TestCase[] {
  return [...halState().testCases.values()].sort(
    (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
  );
}

export function getTestCase(id: string): TestCase | undefined {
  const s = halState();
  const tc = s.testCases.get(id);
  if (!tc) return undefined;
  let resolved = tc;
  // Resolve the live target from the linked "My agents" entry, when set, so the
  // simulation always runs against that target's current address.
  if (tc.targetAgentId) {
    const agent = s.targets.get(tc.targetAgentId);
    if (agent) resolved = { ...resolved, target: agent.target };
  }
  // Merge any attached reusable judges into the inline judge so every run path
  // that consumes getTestCase scores with them.
  if (tc.judgeIds && tc.judgeIds.length > 0) {
    const specs = tc.judgeIds
      .map((jid) => s.judges.get(jid)?.spec)
      .filter((spec): spec is JudgeSpec => Boolean(spec));
    if (specs.length > 0) resolved = { ...resolved, judge: mergeJudgeSpecs(resolved.judge, specs) };
  }
  return resolved;
}

/** The raw stored test case, without target/judge resolution — for editing. */
export function getTestCaseRaw(id: string): TestCase | undefined {
  return halState().testCases.get(id);
}

/**
 * Merge the specs of several saved judges into one JudgeSpec (union of rules,
 * criteria, and metrics), so a set of attached judges can score a call in one
 * pass. Returns undefined when none of the ids resolve to a judge.
 */
export function mergeJudgesById(judgeIds: string[]): JudgeSpec | undefined {
  const s = halState();
  const specs = judgeIds
    .map((jid) => s.judges.get(jid)?.spec)
    .filter((spec): spec is JudgeSpec => Boolean(spec));
  if (specs.length === 0) return undefined;
  return mergeJudgeSpecs({ mode: "all" }, specs);
}

/** Combine a base judge spec with attached judges' specs (union of signals). */
function mergeJudgeSpecs(base: JudgeSpec, extra: JudgeSpec[]): JudgeSpec {
  const merged: JudgeSpec = {
    mode: base.mode ?? "all",
    provider: base.provider,
    model: base.model,
    rules: [...(base.rules ?? [])],
    criteria: [...(base.criteria ?? [])],
    metrics: [...(base.metrics ?? [])],
  };
  for (const spec of extra) {
    if (spec.rules) merged.rules!.push(...spec.rules);
    if (spec.criteria) merged.criteria!.push(...spec.criteria);
    if (spec.metrics) merged.metrics!.push(...spec.metrics);
    if (!merged.model && spec.model) merged.model = spec.model;
    if ((!merged.provider || merged.provider === "auto") && spec.provider) merged.provider = spec.provider;
  }
  // Attaching a judge is an explicit request to evaluate it, so derive the mode
  // from the signals actually present — otherwise a restrictive base mode (e.g.
  // "rules-only") would silently drop an attached LLM judge's criteria.
  const hasRules = (merged.rules?.length ?? 0) > 0;
  const hasLlm = (merged.criteria?.length ?? 0) > 0 || (merged.metrics?.length ?? 0) > 0;
  merged.mode = hasRules && hasLlm ? "all" : hasLlm ? "llm-only" : hasRules ? "rules-only" : merged.mode;
  return merged;
}

/** Attach/replace the reusable judges referenced by a simulation. */
export function setTestCaseJudges(testCaseId: string, judgeIds: string[]): TestCase | undefined {
  const s = halState();
  const tc = s.testCases.get(testCaseId);
  if (!tc) return undefined;
  const next = { ...tc, judgeIds };
  s.testCases.set(testCaseId, next);
  s.db.put("testcases", testCaseId, next, tc.createdAt);
  return next;
}

export function upsertTestCase(tc: TestCase): void {
  const s = halState();
  s.testCases.set(tc.id, tc);
  s.db.put("testcases", tc.id, tc, tc.createdAt);
}

export function deleteTestCase(id: string): boolean {
  const s = halState();
  const ok = s.testCases.delete(id);
  if (ok) s.db.remove("testcases", id);
  return ok;
}

export function saveResult(result: TestResult): void {
  const s = halState();
  s.results.set(result.id, result);
  s.db.put("results", result.id, result, result.startedAt);
}

export function listResults(testCaseId?: string): TestResult[] {
  const all = [...halState().results.values()];
  const filtered = testCaseId ? all.filter((r) => r.testCaseId === testCaseId) : all;
  return filtered.sort((a, b) => b.startedAt - a.startedAt);
}

export function getResult(id: string): TestResult | undefined {
  return halState().results.get(id);
}

export function providers(): ProviderAvailability[] {
  return providerAvailability();
}

// --- Hosted provider accounts & testing agents ------------------------------

/** Accounts, with credentials redacted for client responses. */
export function listAccounts(): ProviderAccount[] {
  return [...halState().accounts.values()].map(redactAccount);
}

export function getAccountRaw(id: string): ProviderAccount | undefined {
  return halState().accounts.get(id);
}

export function upsertAccount(a: ProviderAccount): void {
  const s = halState();
  // Keep plaintext credentials in memory; persist them encrypted at rest.
  s.accounts.set(a.id, a);
  s.db.put("accounts", a.id, { ...a, credentials: encryptCredentials(a.credentials) }, a.createdAt);
}

export function listAgents(): HostedTestingAgent[] {
  return [...halState().agents.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getAgent(id: string): HostedTestingAgent | undefined {
  return halState().agents.get(id);
}

export function upsertAgent(a: HostedTestingAgent): void {
  const s = halState();
  s.agents.set(a.id, a);
  s.db.put("agents", a.id, a, a.createdAt);
}

// --- Target agents ("My agents" — the real agents under test) ---------------

export function listTargets(): TargetAgent[] {
  return [...halState().targets.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getTarget(id: string): TargetAgent | undefined {
  return halState().targets.get(id);
}

export function upsertTarget(t: TargetAgent): void {
  const s = halState();
  s.targets.set(t.id, t);
  s.db.put("targets", t.id, t, t.createdAt);
}

export function deleteTarget(id: string): boolean {
  const s = halState();
  const ok = s.targets.delete(id);
  if (ok) s.db.remove("targets", id);
  return ok;
}

/** The single reusable testing agent for a provider account, if provisioned. */
export function getAgentForAccount(accountId: string): HostedTestingAgent | undefined {
  return [...halState().agents.values()].find((a) => a.accountId === accountId);
}

// --- Judges (reusable scoring configs) --------------------------------------

export function listJudges(): SavedJudge[] {
  return [...halState().judges.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getJudge(id: string): SavedJudge | undefined {
  return halState().judges.get(id);
}

export function upsertJudge(j: SavedJudge): void {
  const s = halState();
  s.judges.set(j.id, j);
  s.db.put("judges", j.id, j, j.createdAt);
}

export function deleteJudge(id: string): boolean {
  const s = halState();
  const ok = s.judges.delete(id);
  if (ok) s.db.remove("judges", id);
  return ok;
}

// --- Production calls (uploaded/transcribed calls for offline analysis) ------

export function listProdCalls(): ProdCall[] {
  return [...halState().prodCalls.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getProdCall(id: string): ProdCall | undefined {
  return halState().prodCalls.get(id);
}

export function upsertProdCall(p: ProdCall): void {
  const s = halState();
  s.prodCalls.set(p.id, p);
  s.db.put("prodcalls", p.id, p, p.createdAt);
}

export function deleteProdCall(id: string): boolean {
  const s = halState();
  const ok = s.prodCalls.delete(id);
  if (ok) s.db.remove("prodcalls", id);
  return ok;
}

function redactAccount(a: ProviderAccount): ProviderAccount {
  const credentials: Record<string, string> = {};
  for (const k of Object.keys(a.credentials)) credentials[k] = "••••••";
  return { ...a, credentials };
}

// --- App settings: transcription (speech-to-text) provider ------------------

export interface TranscriptionSettings {
  id: "transcription";
  /** Provider id, e.g. "deepgram". A dropdown so more can be added later. */
  provider: string;
  /** Secret API key — stored server-side, never returned to the browser. */
  apiKey?: string;
  /** Optional model override (e.g. Deepgram "nova-2"). */
  model?: string;
  updatedAt: number;
}

/** Public (redacted) view of the transcription settings for the browser. */
export interface TranscriptionSettingsPublic {
  provider: string;
  model?: string;
  hasKey: boolean;
  updatedAt: number;
}

const TRANSCRIPTION_DEFAULT: TranscriptionSettings = {
  id: "transcription",
  provider: "deepgram",
  model: "nova-2",
  updatedAt: 0,
};

export function getTranscriptionSettingsRaw(): TranscriptionSettings {
  const rows = halState().db.loadAll<TranscriptionSettings>("settings");
  return rows.find((r) => r.id === "transcription") ?? { ...TRANSCRIPTION_DEFAULT };
}

export function getTranscriptionSettings(): TranscriptionSettingsPublic {
  const s = getTranscriptionSettingsRaw();
  return { provider: s.provider, model: s.model, hasKey: Boolean(s.apiKey), updatedAt: s.updatedAt };
}

export function setTranscriptionSettings(patch: {
  provider?: string;
  apiKey?: string;
  model?: string;
}): TranscriptionSettingsPublic {
  const cur = getTranscriptionSettingsRaw();
  const next: TranscriptionSettings = {
    id: "transcription",
    provider: patch.provider ?? cur.provider,
    // undefined = keep existing key; empty string = explicitly clear it.
    apiKey: patch.apiKey === undefined ? cur.apiKey : patch.apiKey || undefined,
    model: patch.model ?? cur.model,
    updatedAt: Date.now(),
  };
  halState().db.put("settings", "transcription", next, next.updatedAt);
  return getTranscriptionSettings();
}

// --- App secrets / environment (set from the UI, applied to process.env) ------

/** The env vars HAL reads that can be configured from the Settings UI. */
export const SECRET_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "DEEPGRAM_API_KEY",
] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

interface SecretsDoc {
  id: "secrets";
  values: Partial<Record<SecretKey, string>>;
  updatedAt: number;
}

/** Where a secret's live value comes from. */
export interface SecretStatus {
  key: SecretKey;
  set: boolean;
  source: "env" | "stored" | "none";
}

function loadSecretsDoc(db: Persistence): SecretsDoc {
  const rows = db.loadAll<SecretsDoc>("settings");
  return rows.find((r) => r.id === "secrets") ?? { id: "secrets", values: {}, updatedAt: 0 };
}

/**
 * Apply UI-stored secrets to process.env so the rest of the app (LLM factory,
 * telephony, media gateway) reads them without knowing they came from the UI.
 * A real environment variable present at process start always wins; stored
 * values only fill the gaps. Removing a stored value clears it (unless a real
 * env var covers it).
 */
function applySecrets(doc: SecretsDoc): void {
  for (const k of SECRET_KEYS) {
    const real = REAL_ENV[k]?.trim();
    if (real) {
      process.env[k] = REAL_ENV[k]!;
      continue;
    }
    const v = doc.values[k];
    if (v) process.env[k] = v;
    else delete process.env[k];
  }
}

/** Status of each configurable secret — never returns the value itself. */
export function getSecretsStatus(): SecretStatus[] {
  const doc = loadSecretsDoc(halState().db);
  return SECRET_KEYS.map((key) => {
    const real = REAL_ENV[key]?.trim();
    if (real) return { key, set: true, source: "env" };
    if (doc.values[key]) return { key, set: true, source: "stored" };
    return { key, set: false, source: "none" };
  });
}

/**
 * Save UI secrets. For each key: a non-empty string sets it, null or "" clears
 * the stored value, and `undefined` (key omitted) leaves it unchanged. Applied
 * to process.env immediately so per-request consumers (LLM judge, transcription)
 * pick it up without a restart; long-lived services started at boot (telephony /
 * media gateway) need an app restart.
 */
export function setSecrets(patch: Partial<Record<SecretKey, string | null>>): SecretStatus[] {
  const s = halState();
  const doc = loadSecretsDoc(s.db);
  for (const key of SECRET_KEYS) {
    if (!(key in patch)) continue;
    const v = patch[key];
    if (v == null || v === "") delete doc.values[key];
    else doc.values[key] = v;
  }
  doc.updatedAt = Date.now();
  s.db.put("settings", "secrets", doc, doc.updatedAt);
  applySecrets(doc);
  return getSecretsStatus();
}
