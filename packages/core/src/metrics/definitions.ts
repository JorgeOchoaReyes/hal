/**
 * User-defined metrics with typed outputs — HAL's equivalent of Cekura-style
 * "metric output types". A metric is a named evaluator the LLM judge runs over
 * the transcript, producing a typed value (boolean / rating / enum / number)
 * and, optionally, a pass/fail derived from a declared condition.
 *
 * This sits alongside the objective per-call stats in `metrics.ts`: those are
 * always computed from the transcript; these are configurable, semantic
 * judgments a user defines per simulation.
 */

/**
 * The four Cekura-style metric output types:
 *  - boolean: true/false; DIRECTLY affects call success/failure by default.
 *  - rating:  a 0–100% continuous score; informational (does not affect pass/fail).
 *  - numeric: quantitative value (latency, pitch, …); informational.
 *  - enum:    one of predefined categories (e.g. happy / sad / frustrated).
 *
 * Rating/numeric/enum only affect pass/fail if the user opts in with `blocking`
 * plus a pass condition (a "rubric"). Boolean is blocking out of the box.
 */
export type MetricOutputType = "boolean" | "rating" | "numeric" | "enum";

/** How a metric's typed value maps to pass/fail. Omit for informational metrics. */
export type MetricPassCondition =
  | { kind: "is-true" } // boolean
  | { kind: "is-false" } // boolean
  | { kind: "equals"; value: string } // enum
  | { kind: "in"; values: string[] } // enum
  | { kind: "gte"; value: number } // rating / number
  | { kind: "lte"; value: number } // rating / number
  | { kind: "between"; min: number; max: number }; // rating / number

export interface MetricDefinition {
  id: string;
  name: string;
  /** Natural-language definition the judge uses to score this metric. */
  description: string;
  outputType: MetricOutputType;
  /** For `rating`: the percentage scale bounds (default 0..100). */
  scale?: { min: number; max: number };
  /** For `enum`: the allowed categories. */
  options?: string[];
  /** For `number`: an optional unit shown in the UI. */
  unit?: string;
  /** Optional pass/fail condition. When omitted the metric is informational. */
  passIf?: MetricPassCondition;
  /** Whether a failing metric should fail the overall run (default true). */
  blocking?: boolean;
}

export interface MetricResult {
  id: string;
  name: string;
  outputType: MetricOutputType;
  value: boolean | number | string;
  /** null when the metric has no pass condition (informational). */
  passed: boolean | null;
  reasoning?: string;
}

/** Evaluate a metric's typed value against its pass condition. */
export function checkPassCondition(
  def: MetricDefinition,
  value: boolean | number | string,
): boolean | null {
  const c = def.passIf;
  if (!c) return null;
  switch (c.kind) {
    case "is-true":
      return value === true;
    case "is-false":
      return value === false;
    case "equals":
      return String(value) === c.value;
    case "in":
      return c.values.includes(String(value));
    case "gte":
      return Number(value) >= c.value;
    case "lte":
      return Number(value) <= c.value;
    case "between":
      return Number(value) >= c.min && Number(value) <= c.max;
  }
}

/**
 * The pass condition actually applied when judging. Boolean metrics get an
 * implicit `is-true` if none is declared (Cekura: boolean directly affects
 * success/failure); other types stay informational unless a condition is set.
 */
export function effectivePassCondition(def: MetricDefinition): MetricPassCondition | undefined {
  if (def.passIf) return def.passIf;
  if (def.outputType === "boolean") return { kind: "is-true" };
  return undefined;
}

/** Compute pass/fail using the effective (possibly implicit) pass condition. */
export function evaluateMetricPass(
  def: MetricDefinition,
  value: boolean | number | string,
): boolean | null {
  return checkPassCondition({ ...def, passIf: effectivePassCondition(def) }, value);
}

/**
 * Whether a metric's result affects overall run pass/fail. Matching Cekura:
 * boolean affects it by default; rating / numeric / enum are informational
 * unless the user opts in with `blocking: true` (a "rubric").
 */
export function metricAffectsOutcome(def: MetricDefinition): boolean {
  if (def.outputType === "boolean") return def.blocking !== false;
  return def.blocking === true;
}

/** Coerce a raw judged value into the metric's declared output type. */
export function coerceMetricValue(
  def: MetricDefinition,
  raw: unknown,
): boolean | number | string {
  switch (def.outputType) {
    case "boolean":
      if (typeof raw === "boolean") return raw;
      return /^(true|yes|pass|1)$/i.test(String(raw));
    case "rating": {
      // Continuous score on a 0–100% scale (default), informational.
      const s = def.scale ?? { min: 0, max: 100 };
      const n = Number(raw);
      if (Number.isNaN(n)) return s.min;
      return Math.max(s.min, Math.min(s.max, n));
    }
    case "numeric": {
      const n = Number(raw);
      return Number.isNaN(n) ? 0 : n;
    }
    case "enum": {
      const s = String(raw);
      if (def.options && !def.options.includes(s)) {
        // Best-effort match against options, case-insensitive.
        const hit = def.options.find((o) => o.toLowerCase() === s.toLowerCase());
        return hit ?? def.options[0] ?? s;
      }
      return s;
    }
  }
}
