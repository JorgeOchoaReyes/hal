import test from "node:test";
import assert from "node:assert/strict";
import type { Scenario, TargetAgent, TestResult } from "@hal/core";
import { playbackOffsetMs } from "../audioTiming";
import { mainOpeningMessage, testingOpeningMessage } from "../openingMessages";

test("Bland event times align to the actual recording end and never exceed its duration", () => {
  const end = Date.parse("2026-09-27T04:53:29Z");
  const run = { id: "run", testCaseId: "case", status: "passed", startedAt: 0, transcript: [], liveChecks: [],
    context: { transport: "bland", targetAgent: { name: "Main", direction: "inbound" }, testingAgent: { name: "HAL" }, judge: {}, judges: [] }, providerCalls: {
    testingAgent: { provider: "bland", accountId: "account", externalCallId: "call", fetchedAt: 0, details: { end_at: "2026-09-27T04:53:29Z" } },
  } } as TestResult;
  const first = { role: "agent", text: "Hi", startedAt: end - 28_815, audioStartMs: 6485 } as const;
  const last = { role: "agent", text: "Bye", startedAt: end + 141, audioStartMs: 35_441 } as const;
  assert.equal(playbackOffsetMs(run, first, 30_000), 1185);
  assert.equal(playbackOffsetMs(run, last, 30_000), 29_900);
});

test("simulation opening conflict uses the tester script and saved main agent opener", () => {
  const scenario = { persona: { name: "Customer", systemPrompt: "Busy" }, steps: [{ kind: "say", text: "Hi, help please" }] } as Scenario;
  const target = { transport: "telephony", name: "Main", phoneNumber: "+14155550123" } as const;
  assert.equal(testingOpeningMessage(scenario), "Hi, help please");
  assert.equal(mainOpeningMessage(target, { firstMessage: "Welcome" } as TargetAgent), "Welcome");
  assert.equal(testingOpeningMessage({ ...scenario, steps: [{ kind: "wait" }, ...scenario.steps] }), undefined);
});
