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

export type MetricOutputType = "boolean" | "rating" | "enum" | "number";

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
  /** For `rating`: the scale bounds (default 1..5). */
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

/** Coerce a raw judged value into the metric's declared output type. */
export function coerceMetricValue(
  def: MetricDefinition,
  raw: unknown,
): boolean | number | string {
  switch (def.outputType) {
    case "boolean":
      if (typeof raw === "boolean") return raw;
      return /^(true|yes|pass|1)$/i.test(String(raw));
    case "rating":
    case "number": {
      const n = Number(raw);
      if (Number.isNaN(n)) return def.outputType === "rating" ? (def.scale?.min ?? 1) : 0;
      if (def.outputType === "rating" && def.scale) {
        return Math.max(def.scale.min, Math.min(def.scale.max, n));
      }
      return n;
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
