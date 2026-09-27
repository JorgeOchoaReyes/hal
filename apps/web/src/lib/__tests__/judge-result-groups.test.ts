import test from "node:test";
import assert from "node:assert/strict";
import type { JudgeVerdict, RunContext } from "@hal/core";
import { judgeResultGroups } from "../judgeResultGroups";

const baseRule = { kind: "min-turns" as const, count: 2 };
const complianceRule = { kind: "transcript-contains" as const, needle: "hello" };
const csatMetric = { id: "csat", name: "CSAT", description: "Customer satisfaction", outputType: "rating" as const };
const context = {
  transport: "bland", testingAgent: { name: "HAL" }, targetAgent: { name: "Main" },
  judge: { mode: "all", rules: [baseRule, complianceRule], criteria: ["Customer felt helped"], metrics: [csatMetric] },
  judges: [
    { id: "compliance", name: "Compliance", kind: "code", createdAt: 0, spec: { rules: [complianceRule] } },
    { id: "csat", name: "CSAT judge", kind: "llm", createdAt: 0, spec: { criteria: ["Customer felt helped"], metrics: [csatMetric] } },
  ],
} satisfies RunContext;
const verdict: JudgeVerdict = {
  passed: true, score: 0.9, summary: "Overall assessment",
  checks: [
    { id: "rule_a", description: "two turns", passed: true },
    { id: "rule_b", description: "hello", passed: true },
    { id: "judge_c", description: "Customer felt helped", passed: true },
  ],
  metricResults: [{ id: "csat", name: "CSAT", outputType: "rating", value: 85, passed: null, reasoning: "Positive interaction" }],
};

test("combined verdict signals appear on their owning judge cards", () => {
  const groups = judgeResultGroups(verdict, context);
  assert.deepEqual(groups.simulation.checks.map((check) => check.description), ["two turns"]);
  assert.deepEqual(groups.attached[0]?.checks.map((check) => check.description), ["hello"]);
  assert.deepEqual(groups.attached[1]?.checks.map((check) => check.description), ["Customer felt helped"]);
  assert.deepEqual(groups.attached[1]?.metrics.map((metric) => metric.id), ["csat"]);
  assert.deepEqual(groups.unassigned, { checks: [], metrics: [] });
});

test("ambiguous combined signals stay unassigned instead of appearing on the wrong judge", () => {
  const groups = judgeResultGroups({ ...verdict, checks: verdict.checks.slice(0, 2), metricResults: [{ ...verdict.metricResults![0]!, id: "unknown" }] }, context);
  assert.equal(groups.attached[1]?.checks.length, 0);
  assert.equal(groups.unassigned.metrics[0]?.id, "unknown");
});
