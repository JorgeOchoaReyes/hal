import "server-only";
import { join } from "node:path";
import {
  HalEngine,
  sampleTestCases,
  providerAvailability,
  type TestCase,
  type TestResult,
  type ProviderAvailability,
  type ProviderAccount,
  type HostedTestingAgent,
} from "@hal/core";
import { MediaServer, MediaGateway } from "@hal/media";
import { createPersistence, type Persistence } from "./persistence";

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
  engine: HalEngine;
  mediaServer?: MediaServer;
  mediaGateway?: MediaGateway;
}

declare global {
  // eslint-disable-next-line no-var
  var __hal__: HalState | undefined;
}

const DATA_DIR = process.env.HAL_DATA_DIR ?? join(process.cwd(), "data");

function seed(): HalState {
  const db = createPersistence(DATA_DIR);

  const testCases = new Map<string, TestCase>();
  const persisted = db.loadAll<TestCase>("testcases");
  if (persisted.length > 0) {
    for (const tc of persisted) testCases.set(tc.id, tc);
  } else {
    for (const tc of sampleTestCases()) {
      testCases.set(tc.id, tc);
      db.put("testcases", tc.id, tc, tc.createdAt);
    }
  }

  const results = new Map<string, TestResult>();
  for (const r of db.loadAll<TestResult>("results")) results.set(r.id, r);
  const accounts = new Map<string, ProviderAccount>();
  for (const a of db.loadAll<ProviderAccount>("accounts")) accounts.set(a.id, a);
  const agents = new Map<string, HostedTestingAgent>();
  for (const a of db.loadAll<HostedTestingAgent>("agents")) agents.set(a.id, a);

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
  return { db, testCases, results, accounts, agents, engine, mediaServer, mediaGateway };
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
  return halState().testCases.get(id);
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
  s.accounts.set(a.id, a);
  s.db.put("accounts", a.id, a, a.createdAt);
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

function redactAccount(a: ProviderAccount): ProviderAccount {
  const credentials: Record<string, string> = {};
  for (const k of Object.keys(a.credentials)) credentials[k] = "••••••";
  return { ...a, credentials };
}
