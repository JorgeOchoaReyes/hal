import type { CheckResult, JudgeVerdict, RunContext } from "@hal/core";

type MetricResult = NonNullable<JudgeVerdict["metricResults"]>[number];

export interface JudgeSignals {
  checks: CheckResult[];
  metrics: MetricResult[];
}

const empty = (): JudgeSignals => ({ checks: [], metrics: [] });

/** Attribute combined verdict signals only when their source is identifiable. */
export function judgeResultGroups(verdict: JudgeVerdict, context?: RunContext): {
  simulation: JudgeSignals;
  attached: JudgeSignals[];
  unassigned: JudgeSignals;
} {
  const simulation = empty();
  const attached = (context?.judges ?? []).map(empty);
  const unassigned = empty();
  if (!context) {
    unassigned.checks = [...verdict.checks];
    unassigned.metrics = [...(verdict.metricResults ?? [])];
    return { simulation, attached, unassigned };
  }

  const allocateChecks = (checks: CheckResult[], category: "rules" | "criteria") => {
    const total = context.judge[category]?.length ?? 0;
    const attachedCounts = context.judges.map((judge) => judge.spec[category]?.length ?? 0);
    const baseCount = total - attachedCounts.reduce((sum, count) => sum + count, 0);
    if (baseCount < 0 || checks.length !== total) {
      unassigned.checks.push(...checks);
      return;
    }
    simulation.checks.push(...checks.slice(0, baseCount));
    let offset = baseCount;
    attachedCounts.forEach((count, index) => {
      attached[index]!.checks.push(...checks.slice(offset, offset + count));
      offset += count;
    });
  };
  allocateChecks(verdict.checks.filter((check) => check.id.startsWith("rule")), "rules");
  allocateChecks(verdict.checks.filter((check) => check.id.startsWith("judge")), "criteria");
  unassigned.checks.push(...verdict.checks.filter((check) => !check.id.startsWith("rule") && !check.id.startsWith("judge")));

  const ownerByMetric = new Map<string, number | undefined>();
  const metricCounts = new Map<string, number>();
  for (const metric of context.judge.metrics ?? []) metricCounts.set(metric.id, (metricCounts.get(metric.id) ?? 0) + 1);
  const attachedMetricIds = new Set(context.judges.flatMap((judge) => (judge.spec.metrics ?? []).map((metric) => metric.id)));
  for (const metric of context.judge.metrics ?? []) {
    if (!attachedMetricIds.has(metric.id)) ownerByMetric.set(metric.id, -1);
  }
  context.judges.forEach((judge, index) => {
    for (const metric of judge.spec.metrics ?? []) {
      if (ownerByMetric.has(metric.id)) ownerByMetric.set(metric.id, undefined);
      else ownerByMetric.set(metric.id, index);
    }
  });
  for (const metric of verdict.metricResults ?? []) {
    if (metricCounts.get(metric.id) !== 1) { unassigned.metrics.push(metric); continue; }
    const owner = ownerByMetric.get(metric.id);
    if (owner === -1) simulation.metrics.push(metric);
    else if (owner !== undefined) attached[owner]!.metrics.push(metric);
    else unassigned.metrics.push(metric);
  }
  return { simulation, attached, unassigned };
}
