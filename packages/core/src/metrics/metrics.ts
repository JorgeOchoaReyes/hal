import { TestResult, Transcript, RunStatus } from "../types.js";

/**
 * Per-call metrics computed from a finished TestResult. These are what each
 * simulation run gets "labeled" by — objective numbers plus a few derived,
 * human-readable labels for quick scanning in the UI and for aggregation.
 */
export interface LatencyStats {
  avg: number;
  p50: number;
  p95: number;
  max: number;
}

export interface CallMetrics {
  status: RunStatus;
  passed: boolean;
  /** Judge score 0..1 (0 when there is no verdict). */
  score: number;
  durationMs: number;
  totalTurns: number;
  agentTurns: number;
  targetTurns: number;
  /** Latency of the target's responses, in ms. Null when unmeasured. */
  targetLatency: LatencyStats | null;
  /** Average words per target turn — a rough verbosity signal. */
  avgTargetWords: number;
  /** Fraction of live (mid-call) assertions that passed (1 when none). */
  liveCheckPassRate: number;
  /** Fraction of deterministic judge rules that passed (1 when none). */
  ruleCheckPassRate: number;
}

export type LabelTone = "pass" | "fail" | "warn" | "neutral" | "info";

export interface Label {
  text: string;
  tone: LabelTone;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function latencyStats(transcript: Transcript): LatencyStats | null {
  const lats = transcript
    .filter((u) => u.role === "target" && typeof u.latencyMs === "number")
    .map((u) => u.latencyMs!)
    .filter((n) => n >= 0);
  if (lats.length === 0) return null;
  const sorted = [...lats].sort((a, b) => a - b);
  const avg = Math.round(lats.reduce((s, n) => s + n, 0) / lats.length);
  return {
    avg,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1]!,
  };
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function computeMetrics(result: TestResult): CallMetrics {
  const t = result.transcript;
  const agentTurns = t.filter((u) => u.role === "agent").length;
  const targetTurns = t.filter((u) => u.role === "target").length;
  const targetWords = t.filter((u) => u.role === "target").map((u) => wordCount(u.text));
  const avgTargetWords = targetWords.length
    ? Math.round(targetWords.reduce((s, n) => s + n, 0) / targetWords.length)
    : 0;

  const liveTotal = result.liveChecks.length;
  const livePassed = result.liveChecks.filter((c) => c.passed).length;
  const ruleChecks = (result.verdict?.checks ?? []).filter((c) => c.id.startsWith("rule"));
  const rulePassed = ruleChecks.filter((c) => c.passed).length;

  return {
    status: result.status,
    passed: result.status === "passed",
    score: result.verdict?.score ?? 0,
    durationMs: (result.endedAt ?? result.startedAt) - result.startedAt,
    totalTurns: t.length,
    agentTurns,
    targetTurns,
    targetLatency: latencyStats(t),
    avgTargetWords,
    liveCheckPassRate: liveTotal ? livePassed / liveTotal : 1,
    ruleCheckPassRate: ruleChecks.length ? rulePassed / ruleChecks.length : 1,
  };
}

/**
 * Turn metrics into short, human-readable labels for quick scanning. Thresholds
 * are deliberately simple and can be tuned per deployment.
 */
export function deriveLabels(m: CallMetrics): Label[] {
  const labels: Label[] = [];

  switch (m.status) {
    case "passed":
      labels.push({ text: "passed", tone: "pass" });
      break;
    case "failed":
      labels.push({ text: "failed", tone: "fail" });
      break;
    case "errored":
    case "aborted":
      labels.push({ text: m.status, tone: "warn" });
      break;
    default:
      labels.push({ text: m.status, tone: "neutral" });
  }

  labels.push({ text: `score ${Math.round(m.score * 100)}%`, tone: m.score >= 0.7 ? "pass" : "warn" });

  if (m.targetLatency) {
    const p95 = m.targetLatency.p95;
    if (p95 <= 800) labels.push({ text: "snappy", tone: "pass" });
    else if (p95 >= 3000) labels.push({ text: "sluggish", tone: "warn" });
    else labels.push({ text: `p95 ${p95}ms`, tone: "info" });
  }

  if (m.avgTargetWords >= 40) labels.push({ text: "long-winded", tone: "warn" });
  else if (m.avgTargetWords > 0 && m.avgTargetWords <= 8) labels.push({ text: "concise", tone: "info" });

  if (m.liveCheckPassRate < 1) {
    labels.push({
      text: `live ${Math.round(m.liveCheckPassRate * 100)}%`,
      tone: "warn",
    });
  }

  labels.push({ text: `${m.totalTurns} turns`, tone: "neutral" });
  return labels;
}
