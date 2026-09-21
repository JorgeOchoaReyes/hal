import { JudgeRule, Transcript, CheckResult } from "../types.js";
import { id } from "../util/id.js";

/** Evaluate one deterministic rule against the final transcript. */
export function evaluateRule(rule: JudgeRule, transcript: Transcript): CheckResult {
  const checkId = id("rule");
  const fullText = transcript.map((u) => `${u.role}: ${u.text}`).join("\n");

  switch (rule.kind) {
    case "transcript-contains": {
      const hay = rule.ignoreCase ? fullText.toLowerCase() : fullText;
      const needle = rule.ignoreCase ? rule.needle.toLowerCase() : rule.needle;
      const passed = hay.includes(needle);
      return {
        id: checkId,
        description: rule.description ?? `transcript contains "${rule.needle}"`,
        passed,
        detail: passed ? undefined : `"${rule.needle}" not found in transcript`,
      };
    }
    case "transcript-not-contains": {
      const hay = rule.ignoreCase ? fullText.toLowerCase() : fullText;
      const needle = rule.ignoreCase ? rule.needle.toLowerCase() : rule.needle;
      const passed = !hay.includes(needle);
      return {
        id: checkId,
        description: rule.description ?? `transcript does not contain "${rule.needle}"`,
        passed,
        detail: passed ? undefined : `Forbidden phrase "${rule.needle}" appeared`,
      };
    }
    case "regex": {
      const re = new RegExp(rule.pattern, "i");
      const scope = rule.role ? transcript.filter((u) => u.role === rule.role) : transcript;
      const passed = scope.some((u) => re.test(u.text));
      return {
        id: checkId,
        description: rule.description ?? `matches /${rule.pattern}/${rule.role ? ` (${rule.role})` : ""}`,
        passed,
        detail: passed ? undefined : `No ${rule.role ?? "turn"} matched /${rule.pattern}/`,
      };
    }
    case "max-latency": {
      const scope = rule.role ? transcript.filter((u) => u.role === rule.role) : transcript;
      const worst = Math.max(0, ...scope.map((u) => u.latencyMs ?? 0));
      const passed = worst <= rule.ms;
      return {
        id: checkId,
        description: rule.description ?? `${rule.role ?? "any"} latency <= ${rule.ms}ms`,
        passed,
        detail: passed ? undefined : `Worst latency ${worst}ms exceeded ${rule.ms}ms`,
      };
    }
    case "min-turns": {
      const passed = transcript.length >= rule.count;
      return {
        id: checkId,
        description: rule.description ?? `at least ${rule.count} turns`,
        passed,
        detail: passed ? undefined : `Only ${transcript.length} turns`,
      };
    }
    case "max-turns": {
      const passed = transcript.length <= rule.count;
      return {
        id: checkId,
        description: rule.description ?? `at most ${rule.count} turns`,
        passed,
        detail: passed ? undefined : `${transcript.length} turns exceeded ${rule.count}`,
      };
    }
  }
}
