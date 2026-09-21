/**
 * Structured Tests — a rule-based, branching scenario model matching Cekura's
 * schema. Instead of a linear script, the testing agent is a `role` plus a set
 * of `conditions`: each says WHEN a situation occurs and WHAT the agent does.
 *
 *   - id 0 must be FIRST_MESSAGE (the opening line; fixed_message: true).
 *   - "standard" conditions fire when their (LLM-judged) trigger matches the
 *     main agent's latest turn.
 *   - "action_followup" conditions fire on the turn after the condition they
 *     reference, regardless of what the main agent said (scripted sequences).
 *   - fixed_message: true → speak `action` verbatim; false → interpret it as an
 *     instruction and generate a natural reply.
 */

export type StructuredConditionType = "standard" | "action_followup";

export interface StructuredCondition {
  id: number;
  /**
   * "FIRST_MESSAGE" for id 0; an integer (referenced condition id) for
   * action_followup; a free-text trigger description for standard conditions.
   */
  condition: string | number;
  action: string;
  type: StructuredConditionType;
  fixed_message: boolean;
}

export interface StructuredTest {
  role: string;
  conditions: StructuredCondition[];
  scenario_language?: string;
}

import { validateActionTags, renderAction } from "./tags.js";

export const FIRST_MESSAGE = "FIRST_MESSAGE";

/**
 * Validate a structured test against Cekura's rules. Returns a list of error
 * messages (empty when valid).
 */
export function validateStructuredTest(test: StructuredTest): string[] {
  const errors: string[] = [];
  const conditions = test.conditions ?? [];

  if (!test.role || !test.role.trim()) errors.push("role is required");
  if (conditions.length === 0) {
    errors.push("at least one condition is required");
    return errors;
  }

  // First condition rules.
  const first = conditions[0]!;
  if (first.id !== 0) errors.push("the first condition must have id 0");
  if (first.condition !== FIRST_MESSAGE)
    errors.push(`the first condition's condition must equal "${FIRST_MESSAGE}"`);
  if (first.fixed_message !== true)
    errors.push("the first condition (FIRST_MESSAGE) must have fixed_message: true");

  const seen = new Set<number>();
  for (const c of conditions) {
    if (typeof c.id !== "number") errors.push(`condition id must be a number (got ${String(c.id)})`);
    if (seen.has(c.id)) errors.push(`duplicate condition id ${c.id}`);
    seen.add(c.id);

    if (c.type !== "standard" && c.type !== "action_followup")
      errors.push(`condition ${c.id}: type must be "standard" or "action_followup"`);
    if (typeof c.fixed_message !== "boolean")
      errors.push(`condition ${c.id}: fixed_message must be true or false`);

    const isFirst = c.id === 0;
    if (!isFirst && (!c.action || !c.action.trim()))
      errors.push(`condition ${c.id}: action cannot be empty`);

    if (c.type === "action_followup") {
      if (typeof c.condition !== "number")
        errors.push(`condition ${c.id}: action_followup condition must be an integer id`);
      else if (!conditions.some((o) => o.id === c.condition))
        errors.push(`condition ${c.id}: action_followup references unknown id ${c.condition}`);
    } else if (!isFirst) {
      if (typeof c.condition !== "string" || !c.condition.trim())
        errors.push(`condition ${c.id}: standard condition must be a non-empty trigger string`);
    }

    // Control tags are only valid in fixed-message actions.
    if (c.fixed_message) {
      for (const e of validateActionTags(c.action, { isFollowup: c.type === "action_followup" })) {
        errors.push(`condition ${c.id}: ${e}`);
      }
    } else if (/<[a-z_]+[\s/>]/i.test(c.action)) {
      errors.push(`condition ${c.id}: tags require fixed_message: true`);
    }
  }

  return errors;
}

/**
 * Turn a fixed-message action into spoken text: strip supported control tags
 * (keeping the inner text of wrapping tags like <spell>) and detect <endcall>.
 * Full tag semantics (audio, dtmf, ivr, functions, …) are platform features and
 * are not simulated in text/mock mode — the tags are removed so they are never
 * spoken literally.
 */
export function renderFixedMessage(action: string): { text: string; endCall: boolean } {
  const r = renderAction(action);
  return { text: r.text, endCall: r.endCall };
}

/**
 * Compile a Structured Test into a deterministic instruction prompt suitable as
 * a hosted agent's system prompt / task (e.g. Bland, Vapi). This lets the exact
 * branching decision tree run on a provider that executes a single prompt —
 * ideal for deterministic tests where the platform (not HAL) drives the call.
 */
export function compileStructuredToPrompt(test: StructuredTest): string {
  const lines: string[] = [
    `ROLE: ${test.role}`,
    "",
    "You are the CALLER testing another voice AI. Follow this script deterministically.",
    "Say fixed lines verbatim; for instruction steps, phrase a natural reply. End the call when told.",
    "",
  ];
  for (const c of test.conditions) {
    const kind = c.fixed_message ? "SAY VERBATIM" : "DO";
    if (c.id === 0) {
      const opener = c.action.trim() ? `Open the call with: "${renderFixedMessage(c.action).text}"` : "Wait for the other party to speak first.";
      lines.push(`1. ${opener}`);
      continue;
    }
    if (c.type === "action_followup") {
      lines.push(`- On the turn after step #${c.condition}, ${kind}: ${strip(c)}`);
    } else {
      lines.push(`- WHEN ${String(c.condition)} → ${kind}: ${strip(c)}`);
    }
  }
  return lines.join("\n");
}

function strip(c: StructuredCondition): string {
  return c.fixed_message ? `"${renderFixedMessage(c.action).text}"` : c.action;
}
