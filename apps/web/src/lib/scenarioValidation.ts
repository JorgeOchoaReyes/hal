import { validateStructuredTest } from "@hal/core";

/** Validate edited scripts before they reach either the live or hosted runner. */
export function validateScenario(value: unknown): string | undefined {
  const s = value as any;
  if (!s || typeof s !== "object" || typeof s.persona?.name !== "string" || !s.persona.name.trim() || typeof s.persona.systemPrompt !== "string") return "A persona name and instructions are required";
  if (s.description !== undefined && typeof s.description !== "string") return "Description must be text";
  if (!Array.isArray(s.steps) || s.steps.length > 200) return "Scenario must contain an array of up to 200 steps";
  for (const field of ["maxTurns", "maxDurationMs"]) if (s[field] !== undefined && (!Number.isFinite(s[field]) || s[field] <= 0)) return `${field} must be positive`;
  const regex = (v: unknown) => { if (v === undefined || v === "") return true; if (typeof v !== "string") return false; try { new RegExp(v); return true; } catch { return false; } };
  const positive = (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v) && v >= 0);
  const action = (a: any): boolean => Boolean(a && (a.kind === "hangup" || a.kind === "say" && typeof a.text === "string" && a.text.trim() || a.kind === "prompt" && typeof a.directive === "string" && a.directive.trim() || a.kind === "goto" && Number.isInteger(a.step) && a.step >= 0 && a.step < s.steps.length));
  for (const [i, step] of s.steps.entries()) {
    let valid = false;
    if (step?.kind === "say") valid = typeof step.text === "string" && Boolean(step.text.trim()) && positive(step.delayMs);
    if (step?.kind === "prompt") valid = typeof step.directive === "string" && Boolean(step.directive.trim()) && positive(step.maxTurns);
    if (step?.kind === "wait") valid = regex(step.until) && positive(step.timeoutMs);
    if (step?.kind === "hangup") valid = true;
    if (step?.kind === "expect") valid = typeof step.assertion?.id === "string" && typeof step.assertion?.description === "string" && regex(step.assertion.matches);
    if (step?.kind === "branch") valid = Array.isArray(step.branches) && step.branches.length > 0 && step.branches.every((b: any) => b && typeof b.when === "string" && regex(b.when) && action(b.action)) && (!step.fallback || action(step.fallback)) && positive(step.maxVisits);
    if (!valid) return `Step ${i + 1} is invalid. Check its text, conditions, and numeric options.`;
  }
  if (s.structured != null) {
    if (!Array.isArray(s.structured.conditions) || s.structured.conditions.length > 200 || typeof s.structured.role !== "string" || s.structured.conditions.some((c: any) => !c || typeof c.action !== "string")) return "Invalid structured scenario";
    const errors = validateStructuredTest(s.structured);
    if (errors.length) return errors.join("; ");
  } else if (!s.steps.length) return "Add at least one scenario step";
}
