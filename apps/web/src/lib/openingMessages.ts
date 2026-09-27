import type { Scenario, Target, TargetAgent } from "@hal/core";
import { firstMessageOf } from "@hal/core/structured";

export function testingOpeningMessage(scenario: Scenario): string | undefined {
  if (scenario.structured) return firstMessageOf(scenario.structured);
  for (const step of scenario.steps) {
    if (step.kind === "expect") continue;
    if (step.kind === "say") return step.text.trim() || undefined;
    if (step.kind === "prompt") return `Generated from: ${step.directive}`;
    return undefined;
  }
  return undefined;
}

export function mainOpeningMessage(target: Target, agent?: TargetAgent): string | undefined {
  if (agent?.firstMessage?.trim()) return agent.firstMessage.trim();
  return target.transport === "mock" ? target.mock.greeting?.trim() || undefined : undefined;
}
