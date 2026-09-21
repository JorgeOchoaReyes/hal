import "server-only";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  HalEngine,
  sampleTestCases,
  providerAvailability,
  type TestCase,
  type TestResult,
  type ProviderAvailability,
} from "@hal/core";
import { MediaServer } from "@hal/media";

/**
 * Process-wide state. Test cases and results are persisted to JSON files under
 * a data dir so simulations you create and runs you execute survive a restart.
 * Swap this module for a real DB without touching the routes or UI.
 *
 * Stored on globalThis so Next.js dev hot-reload doesn't wipe state.
 */
interface HalState {
  testCases: Map<string, TestCase>;
  results: Map<string, TestResult>;
  engine: HalEngine;
  mediaServer?: MediaServer;
}

declare global {
  // eslint-disable-next-line no-var
  var __hal__: HalState | undefined;
}

const DATA_DIR = process.env.HAL_DATA_DIR ?? join(process.cwd(), "data");
const TESTCASES_FILE = join(DATA_DIR, "testcases.json");
const RESULTS_FILE = join(DATA_DIR, "results.json");

function loadJson<T>(file: string): T[] {
  try {
    if (!existsSync(file)) return [];
    return JSON.parse(readFileSync(file, "utf8")) as T[];
  } catch {
    return [];
  }
}

function saveJson(file: string, data: unknown): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    // Persistence is best-effort; never crash a request over it.
    // eslint-disable-next-line no-console
    console.warn("[hal] failed to persist", file, err);
  }
}

function seed(): HalState {
  const testCases = new Map<string, TestCase>();
  const persisted = loadJson<TestCase>(TESTCASES_FILE);
  if (persisted.length > 0) {
    for (const tc of persisted) testCases.set(tc.id, tc);
  } else {
    for (const tc of sampleTestCases()) testCases.set(tc.id, tc);
    saveJson(TESTCASES_FILE, [...testCases.values()]);
  }

  const results = new Map<string, TestResult>();
  for (const r of loadJson<TestResult>(RESULTS_FILE)) results.set(r.id, r);

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

  const engine = new HalEngine({
    telephony: {
      config: {},
      bridgeFactory: mediaServer?.bridgeFactory,
    },
  });

  return { testCases, results, engine, mediaServer };
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
  saveJson(TESTCASES_FILE, [...s.testCases.values()]);
}

export function deleteTestCase(id: string): boolean {
  const s = halState();
  const ok = s.testCases.delete(id);
  if (ok) saveJson(TESTCASES_FILE, [...s.testCases.values()]);
  return ok;
}

export function saveResult(result: TestResult): void {
  const s = halState();
  s.results.set(result.id, result);
  // Keep the most recent 200 results on disk.
  const all = [...s.results.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 200);
  saveJson(RESULTS_FILE, all);
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
