import { LLMClient } from "../llm/client.js";
import { Transcript } from "../types.js";
import {
  MetricDefinition,
  MetricResult,
  coerceMetricValue,
  evaluateMetricPass,
} from "./definitions.js";

/**
 * Evaluate a set of typed metrics against a transcript using the LLM judge.
 * One request scores every metric, returning a typed value + reasoning each,
 * which we coerce to the declared output type and check against the pass
 * condition.
 */
export async function evaluateMetrics(
  llm: LLMClient,
  metrics: MetricDefinition[],
  transcript: Transcript,
  model?: string,
): Promise<MetricResult[]> {
  if (metrics.length === 0) return [];

  const convo = transcript.map((u) => `${u.role.toUpperCase()}: ${u.text}`).join("\n");
  const spec = metrics.map((m) => describeMetric(m)).join("\n");

  const prompt =
    `You are an evaluator scoring a voice-AI test call transcript against a set of metrics.\n` +
    `The AGENT is the tester (caller); the TARGET is the voice AI under test.\n\n` +
    `Transcript:\n${convo}\n\n` +
    `Metrics to score:\n${spec}\n\n` +
    `Return a JSON object of the form {"results": [{"id": string, "value": <typed>, ` +
    `"reasoning": string}]}, one entry per metric id above. For boolean metrics use ` +
    `true/false; for rating use a number in range; for enum use exactly one of the ` +
    `options; for number use a number. Be strict and base every judgment only on the ` +
    `transcript.`;

  let raw: string;
  try {
    raw = await llm.complete({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      maxTokens: 900,
      json: true,
    });
  } catch (err) {
    return metrics.map((m) => errorResult(m, (err as Error).message));
  }

  const parsed = parseResults(raw);
  return metrics.map((m) => {
    const found = parsed.get(m.id);
    if (found === undefined) return errorResult(m, "no result returned");
    const value = coerceMetricValue(m, found.value);
    return {
      id: m.id,
      name: m.name,
      outputType: m.outputType,
      value,
      passed: evaluateMetricPass(m, value),
      reasoning: found.reasoning,
    };
  });
}

function describeMetric(m: MetricDefinition): string {
  const parts = [`- id="${m.id}" name="${m.name}" type=${m.outputType}: ${m.description}`];
  if (m.outputType === "rating") {
    const s = m.scale ?? { min: 0, max: 100 };
    parts.push(`  (score from ${s.min} to ${s.max})`);
  }
  if (m.outputType === "enum") {
    parts.push(`  (one of: ${(m.options ?? []).join(", ")})`);
  }
  if (m.outputType === "numeric" && m.unit) parts.push(`  (unit: ${m.unit})`);
  return parts.join("\n");
}

function errorResult(m: MetricDefinition, detail: string): MetricResult {
  const fallback: boolean | number | string =
    m.outputType === "boolean"
      ? false
      : m.outputType === "enum"
        ? (m.options?.[0] ?? "")
        : m.outputType === "rating"
          ? (m.scale?.min ?? 0)
          : 0;
  return {
    id: m.id,
    name: m.name,
    outputType: m.outputType,
    value: fallback,
    passed: m.passIf ? false : null,
    reasoning: `Not evaluated: ${detail}`,
  };
}

interface RawEntry {
  value: unknown;
  reasoning?: string;
}

function parseResults(raw: string): Map<string, RawEntry> {
  const out = new Map<string, RawEntry>();
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return out;
    try {
      obj = JSON.parse(m[0]);
    } catch {
      return out;
    }
  }
  const results = (obj as { results?: Array<{ id?: string; value?: unknown; reasoning?: string }> })
    ?.results;
  if (Array.isArray(results)) {
    for (const r of results) {
      if (r?.id != null) out.set(String(r.id), { value: r.value, reasoning: r.reasoning });
    }
  }
  return out;
}
