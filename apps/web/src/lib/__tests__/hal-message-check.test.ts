import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TestResult } from "@hal/core";
import { halMessageCheck } from "../halMessageCheck";
import RunActivityTimeline from "../../components/RunActivityTimeline";

const run = {
  id: "run-test", testCaseId: "case-test", status: "passed", startedAt: 0,
  transcript: [
    { role: "agent", text: "Hi, I'd like some help please!", startedAt: 10, audioStartMs: 500, metadataSource: "targetAgent", meta: { nodeId: "main-node" } },
    { role: "target", text: "How can I help?", startedAt: 20, metadataSource: "targetAgent", meta: { nodeId: "response-node" } },
    { role: "agent", text: "hello?", startedAt: 30, metadataSource: "targetAgent" },
  ],
  trace: [
    { side: "testingAgent", kind: "node", label: "Tester opening", at: 11 },
    { side: "targetAgent", kind: "tool-call", label: "lookup", at: 21 },
    { side: "targetAgent", kind: "event", label: "recording.completed", at: 25, data: { event_type: "recording.completed" } },
  ],
  liveChecks: [],
  context: { transport: "bland", testingAgent: { name: "HAL", configuration: { steps: [
    { kind: "say", text: "Hi, I'd like some help please." },
    { kind: "say", text: "need help now" },
    { kind: "say", text: "hello?" },
    { kind: "hangup" },
  ] } }, targetAgent: { name: "Main" }, judge: {}, judges: [] },
} as TestResult;

test("HAL message check matches fixed script lines in order and reports missing lines", () => {
  const check = halMessageCheck(run)!;
  assert.deepEqual(check.expected.map((item) => item.matched), [true, false, true]);
  assert.equal(check.expectsHangup, true);
  assert.deepEqual(check.unplanned, []);
});

test("activity places speech by speaker and metadata by provider source", () => {
  const html = renderToStaticMarkup(createElement(RunActivityTimeline, { run, primarySide: "targetAgent" }));
  assert.match(html, /activity-left[^>]*>.*?Testing agent · speech.*?Hi, I/);
  assert.match(html, /activity-right[^>]*>.*?Main agent metadata for testing agent speech/);
  assert.match(html, /activity-left[^>]*>.*?Tester opening/);
  assert.match(html, /activity-right[^>]*>.*?lookup/);
  assert.equal((html.match(/activity-collapsible/g) ?? []).length, 3);
  assert.match(html, /<summary>Visited node: Tester opening<\/summary>/);
  assert.match(html, /<summary>Tool call: lookup<\/summary>/);
  assert.match(html, /<summary>Provider event: recording completed<\/summary>/);
});
