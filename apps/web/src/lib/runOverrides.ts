import type { TestCase } from "@hal/core";
import { getTestCase, getTestCaseRaw, getTarget, mergeJudgesById } from "@/lib/store";

export interface RunOverrides {
  /**
   * Override the agent under test for this run only:
   * - `null`/`undefined` — no override, use the simulation's own target.
   * - `""` — explicit "simulated (mock)" — use the simulation's original inline
   *   target, ignoring any saved `targetAgentId`.
   * - a target id — resolve that saved "My agents" entry's target.
   */
  targetAgentId?: string | null;
  /**
   * Override the judges scoring this run only:
   * - `null`/`undefined` — no override, use the simulation's own attached judges.
   * - an array (possibly empty) — score with exactly these judges instead.
   */
  judgeIds?: string[] | null;
}

export interface ResolvedRun {
  testCase?: TestCase;
  error?: string;
  status?: number;
}

/**
 * Build the TestCase a run should actually execute against, applying any
 * per-run overrides (target agent, judges) on top of the saved simulation —
 * without persisting them. Shared by the single-run and batch-run endpoints.
 */
export function resolveOverriddenTestCase(testCaseId: string, overrides: RunOverrides): ResolvedRun {
  const testCase = getTestCase(testCaseId);
  if (!testCase) return { error: "Unknown test case", status: 404 };
  let resolved = testCase;

  if (overrides.targetAgentId !== null && overrides.targetAgentId !== undefined) {
    if (overrides.targetAgentId) {
      const agent = getTarget(overrides.targetAgentId);
      if (!agent) return { error: "Unknown target agent", status: 404 };
      if (agent.direction === "outbound") {
        return {
          error:
            "This agent is marked outbound (it places calls). HAL dialing it isn't supported yet — pick an inbound agent, or run against the simulated target.",
          status: 400,
        };
      }
      resolved = { ...resolved, target: agent.target, targetAgentId: agent.id };
    } else {
      const raw = getTestCaseRaw(testCaseId);
      resolved = { ...resolved, target: raw?.target ?? resolved.target, targetAgentId: undefined };
    }
  }

  if (overrides.judgeIds) {
    resolved = { ...resolved, judge: mergeJudgesById(overrides.judgeIds) ?? { mode: "all" }, judgeIds: overrides.judgeIds };
  }

  return { testCase: resolved };
}
