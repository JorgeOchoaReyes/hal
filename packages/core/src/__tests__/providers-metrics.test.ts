import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDER_TEMPLATES,
  getProviderTemplate,
  providerAvailability,
  computeMetrics,
  deriveLabels,
  type TestResult,
} from "../index.js";

test("every provider template builds a target of its declared transport", () => {
  for (const t of PROVIDER_TEMPLATES) {
    const config: Record<string, string> = {};
    for (const f of t.fields) config[f.key] = "x";
    const target = t.buildTarget("Demo", config);
    assert.equal(target.transport, t.transport, `${t.id} transport mismatch`);
    assert.equal(target.name, "Demo");
  }
});

test("provider availability reflects required env vars", () => {
  const avail = providerAvailability({}); // empty env
  const twilio = avail.find((a) => a.id === "twilio")!;
  const mock = avail.find((a) => a.id === "mock")!;
  assert.equal(mock.available, true, "mock needs no env");
  assert.equal(twilio.available, false, "twilio needs credentials");
  assert.ok(twilio.missingEnv.includes("TWILIO_ACCOUNT_SID"));

  const withCreds = providerAvailability({
    TWILIO_ACCOUNT_SID: "a",
    TWILIO_AUTH_TOKEN: "b",
    TWILIO_FROM_NUMBER: "+1",
  });
  assert.equal(withCreds.find((a) => a.id === "twilio")!.available, true);
});

test("getProviderTemplate finds and misses correctly", () => {
  assert.ok(getProviderTemplate("twilio"));
  assert.equal(getProviderTemplate("nope"), undefined);
});

function sampleResult(overrides: Partial<TestResult> = {}): TestResult {
  const start = 1_000;
  return {
    id: "r1",
    testCaseId: "tc1",
    status: "passed",
    startedAt: start,
    endedAt: start + 5000,
    transcript: [
      { role: "target", text: "Hello, how can I help?", startedAt: start, latencyMs: 100 },
      { role: "agent", text: "I'd like to book.", startedAt: start + 200 },
      { role: "target", text: "Sure, what day?", startedAt: start + 400, latencyMs: 500 },
    ],
    liveChecks: [{ id: "c1", description: "asks day", passed: true }],
    verdict: {
      passed: true,
      score: 0.85,
      summary: "ok",
      checks: [{ id: "rule_1", description: "min turns", passed: true }],
    },
    ...overrides,
  };
}

test("computeMetrics derives turn counts, latency and pass rates", () => {
  const m = computeMetrics(sampleResult());
  assert.equal(m.totalTurns, 3);
  assert.equal(m.agentTurns, 1);
  assert.equal(m.targetTurns, 2);
  assert.equal(m.durationMs, 5000);
  assert.ok(m.targetLatency);
  assert.equal(m.targetLatency!.max, 500);
  assert.equal(m.liveCheckPassRate, 1);
  assert.equal(m.ruleCheckPassRate, 1);
  assert.equal(m.passed, true);
});

test("deriveLabels reflects pass/fail and latency", () => {
  const pass = deriveLabels(computeMetrics(sampleResult()));
  assert.ok(pass.some((l) => l.text === "passed" && l.tone === "pass"));
  assert.ok(pass.some((l) => l.text === "snappy"));

  const failed = deriveLabels(
    computeMetrics(
      sampleResult({
        status: "failed",
        verdict: { passed: false, score: 0.2, summary: "no", checks: [] },
      }),
    ),
  );
  assert.ok(failed.some((l) => l.text === "failed" && l.tone === "fail"));
});
