import { renderFixedMessage, type TestResult } from "@hal/core";

export interface HalMessageCheck {
  expected: Array<{ text: string; source: string; matched: boolean; actualIndex?: number; actualText?: string }>;
  actual: string[];
  unplanned: string[];
  instructionCount: number;
  expectsHangup: boolean;
}

const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");

/** Compare only fixed speech. Prompted and conditional instructions have no predetermined wording. */
export function halMessageCheck(run: TestResult): HalMessageCheck | undefined {
  const configuration = run.context?.testingAgent.configuration;
  if (!configuration) return undefined;
  const expected: HalMessageCheck["expected"] = [];
  let instructionCount = 0;
  let expectsHangup = false;
  if (configuration.structured) {
    for (const condition of configuration.structured.conditions) {
      if (!condition.fixed_message) { instructionCount++; continue; }
      const rendered = renderFixedMessage(condition.action);
      if (rendered.text.trim()) expected.push({ text: rendered.text.trim(), source: `Condition ${condition.id}`, matched: false });
      if (rendered.endCall) expectsHangup = true;
    }
  } else {
    for (const [index, step] of (configuration.steps ?? []).entries()) {
      if (step.kind === "say") expected.push({ text: step.text.trim(), source: `Step ${index + 1}`, matched: false });
      else if (step.kind === "hangup") expectsHangup = true;
      else if (step.kind === "prompt" || step.kind === "branch") instructionCount++;
    }
  }
  const actual = run.transcript.filter((turn) => turn.role === "agent").map((turn) => turn.text);
  const a = expected.map((item) => normalize(item.text));
  const b = actual.map(normalize);
  const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    dp[i]![j] = a[i] && a[i] === b[j] ? 1 + dp[i + 1]![j + 1]! : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  }
  const used = new Set<number>();
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] && a[i] === b[j]) {
      expected[i] = { ...expected[i]!, matched: true, actualIndex: j, actualText: actual[j] };
      used.add(j); i++; j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return { expected, actual, unplanned: actual.filter((_, index) => !used.has(index)), instructionCount, expectsHangup };
}
