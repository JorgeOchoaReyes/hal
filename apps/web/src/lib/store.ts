import "server-only";
import { HalEngine, sampleTestCases, type TestCase, type TestResult } from "@hal/core";

/**
 * Process-wide singletons. In-memory is fine for a self-hosted single-node
 * deployment and keeps the scaffold dependency-free; swap this module for a DB
 * (Prisma/SQLite, Postgres) without touching the routes or UI.
 *
 * Stored on globalThis so Next.js dev hot-reload doesn't wipe state.
 */
interface HalState {
  testCases: Map<string, TestCase>;
  results: Map<string, TestResult>;
  engine: HalEngine;
}

declare global {
  // eslint-disable-next-line no-var
  var __hal__: HalState | undefined;
}

function seed(): HalState {
  const testCases = new Map<string, TestCase>();
  for (const tc of sampleTestCases()) testCases.set(tc.id, tc);
  return {
    testCases,
    results: new Map(),
    // The engine auto-detects OpenAI/Anthropic keys and falls back to mock.
    engine: new HalEngine({
      telephony: { config: {} },
    }),
  };
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
  halState().testCases.set(tc.id, tc);
}

export function deleteTestCase(id: string): boolean {
  return halState().testCases.delete(id);
}

export function saveResult(result: TestResult): void {
  halState().results.set(result.id, result);
}

export function listResults(testCaseId?: string): TestResult[] {
  const all = [...halState().results.values()];
  const filtered = testCaseId ? all.filter((r) => r.testCaseId === testCaseId) : all;
  return filtered.sort((a, b) => b.startedAt - a.startedAt);
}

export function getResult(id: string): TestResult | undefined {
  return halState().results.get(id);
}
