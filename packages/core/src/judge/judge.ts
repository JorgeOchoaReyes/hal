import { JudgeSpec, Transcript, JudgeVerdict, CheckResult } from "../types.js";
import { LLMClient } from "../llm/client.js";
import { evaluateRule } from "./rules.js";
import { evaluateMetrics } from "../metrics/evaluator.js";
import { MetricResult } from "../metrics/definitions.js";
import { id } from "../util/id.js";

/**
 * The Judge classifies a completed conversation as pass/fail. It combines:
 *  - deterministic rules (free, fast, reproducible)
 *  - an LLM judge over natural-language criteria (flexible, semantic)
 *
 * The `mode` in the JudgeSpec decides how the two are combined.
 */
export class Judge {
  constructor(private readonly llm: LLMClient) {}

  async evaluate(spec: JudgeSpec, transcript: Transcript): Promise<JudgeVerdict> {
    const mode = spec.mode ?? "all";
    const checks: CheckResult[] = [];

    // 1. Rule checks
    let rulesPassed = true;
    if (mode !== "llm-only") {
      for (const rule of spec.rules ?? []) {
        const result = evaluateRule(rule, transcript);
        checks.push(result);
        if (!result.passed) rulesPassed = false;
      }
    }

    // 2. LLM judge over criteria
    let llmPassed = true;
    let llmScore = 1;
    let summary = "All deterministic checks passed.";

    if (mode !== "rules-only" && (spec.criteria?.length ?? 0) > 0) {
      const verdict = await this.llmJudge(spec, transcript);
      llmPassed = verdict.passed;
      llmScore = verdict.score;
      summary = verdict.summary;
      checks.push(...verdict.checks);
    }

    // 3. Typed metrics (boolean / rating / enum / number)
    let metricResults: MetricResult[] | undefined;
    let metricsPassed = true;
    if (mode !== "rules-only" && (spec.metrics?.length ?? 0) > 0) {
      metricResults = await evaluateMetrics(this.llm, spec.metrics!, transcript, spec.model);
      const blockingById = new Map(spec.metrics!.map((m) => [m.id, m.blocking !== false]));
      for (const r of metricResults) {
        if (r.passed === false && blockingById.get(r.id)) metricsPassed = false;
      }
    }

    let passed: boolean;
    switch (mode) {
      case "rules-only":
        passed = rulesPassed;
        break;
      case "llm-only":
        passed = llmPassed && metricsPassed;
        break;
      case "all":
      default:
        passed = rulesPassed && llmPassed && metricsPassed;
    }

    // Overall score blends the LLM score with the rule pass rate.
    const ruleResults = checks.filter((c) => c.id.startsWith("rule"));
    const rulePassRate = ruleResults.length
      ? ruleResults.filter((c) => c.passed).length / ruleResults.length
      : 1;
    const score =
      mode === "rules-only"
        ? rulePassRate
        : mode === "llm-only"
          ? llmScore
          : (rulePassRate + llmScore) / 2;

    return {
      passed,
      score: Number(score.toFixed(3)),
      summary,
      checks,
      metricResults,
    };
  }

  private async llmJudge(
    spec: JudgeSpec,
    transcript: Transcript,
  ): Promise<JudgeVerdict> {
    const convo = transcript.map((u) => `${u.role.toUpperCase()}: ${u.text}`).join("\n");
    const criteria = (spec.criteria ?? []).map((c, i) => `${i + 1}. ${c}`).join("\n");

    const prompt =
      `You are an impartial evaluator ("judge") for a voice-AI test call.\n` +
      `The AGENT is a tester; the TARGET is the voice AI under test.\n\n` +
      `Transcript:\n${convo}\n\n` +
      `Pass criteria — the TARGET must satisfy ALL of these:\n${criteria}\n\n` +
      `Respond with a JSON object exactly like:\n` +
      `{"passed": boolean, "score": number between 0 and 1, "summary": string, ` +
      `"checks": [{"description": string, "passed": boolean, "detail": string}]}\n` +
      `Include one check per criterion. Be strict but fair.`;

    let raw: string;
    try {
      raw = await this.llm.complete({
        model: spec.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        maxTokens: 700,
        json: true,
      });
    } catch (err) {
      return {
        passed: false,
        score: 0,
        summary: `Judge LLM error: ${(err as Error).message}`,
        checks: [],
      };
    }

    const parsed = safeParse(raw);
    if (!parsed) {
      return {
        passed: false,
        score: 0,
        summary: "Judge returned unparseable output.",
        checks: [{ id: id("judge"), description: "valid judge output", passed: false, detail: raw.slice(0, 200) }],
      };
    }

    const checks: CheckResult[] = (parsed.checks ?? []).map((c) => ({
      id: id("judge"),
      description: c.description ?? "criterion",
      passed: Boolean(c.passed),
      detail: c.detail,
    }));

    return {
      passed: Boolean(parsed.passed),
      score: clamp01(Number(parsed.score ?? (parsed.passed ? 1 : 0))),
      summary: parsed.summary ?? (parsed.passed ? "Passed." : "Failed."),
      checks,
    };
  }
}

interface RawVerdict {
  passed?: boolean;
  score?: number;
  summary?: string;
  checks?: Array<{ description?: string; passed?: boolean; detail?: string }>;
}

function safeParse(raw: string): RawVerdict | null {
  try {
    return JSON.parse(raw) as RawVerdict;
  } catch {
    // Try to extract the first {...} block.
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as RawVerdict;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
