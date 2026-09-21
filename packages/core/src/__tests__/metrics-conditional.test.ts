import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkPassCondition,
  coerceMetricValue,
  evaluateMetrics,
  MockLLMClient,
  Conductor,
  scenario,
  type MetricDefinition,
  type Persona,
  type Transcript,
} from "../index.js";

// --- Typed metrics -----------------------------------------------------------

test("coerceMetricValue clamps ratings and matches enum options", () => {
  const rating: MetricDefinition = {
    id: "q",
    name: "quality",
    description: "",
    outputType: "rating",
    scale: { min: 1, max: 5 },
  };
  assert.equal(coerceMetricValue(rating, 9), 5);
  assert.equal(coerceMetricValue(rating, 0), 1);

  const en: MetricDefinition = {
    id: "o",
    name: "outcome",
    description: "",
    outputType: "enum",
    options: ["resolved", "escalated", "abandoned"],
  };
  assert.equal(coerceMetricValue(en, "Resolved"), "resolved");
  assert.equal(coerceMetricValue(en, "nonsense"), "resolved");
});

test("checkPassCondition covers each output type", () => {
  assert.equal(
    checkPassCondition({ id: "a", name: "", description: "", outputType: "boolean", passIf: { kind: "is-true" } }, true),
    true,
  );
  assert.equal(
    checkPassCondition({ id: "a", name: "", description: "", outputType: "rating", passIf: { kind: "gte", value: 4 } }, 3),
    false,
  );
  assert.equal(
    checkPassCondition(
      { id: "a", name: "", description: "", outputType: "enum", passIf: { kind: "in", values: ["resolved"] } },
      "resolved",
    ),
    true,
  );
  assert.equal(
    checkPassCondition({ id: "a", name: "", description: "", outputType: "number", passIf: { kind: "between", min: 1, max: 3 } }, 2),
    true,
  );
  // No passIf → informational (null).
  assert.equal(
    checkPassCondition({ id: "a", name: "", description: "", outputType: "boolean" }, true),
    null,
  );
});

test("evaluateMetrics returns one typed result per metric (mock LLM)", async () => {
  const transcript: Transcript = [
    { role: "target", text: "Sure, I booked your appointment for Tuesday.", startedAt: 0 },
  ];
  const metrics: MetricDefinition[] = [
    { id: "booked", name: "Booked", description: "Did it book?", outputType: "boolean", passIf: { kind: "is-true" } },
    { id: "tone", name: "Tone", description: "1-5 politeness", outputType: "rating", scale: { min: 1, max: 5 } },
  ];
  const results = await evaluateMetrics(new MockLLMClient(), metrics, transcript);
  assert.equal(results.length, 2);
  assert.equal(results[0]!.id, "booked");
  assert.equal(results[0]!.outputType, "boolean");
  assert.equal(results[1]!.outputType, "rating");
});

// --- Conditional actions -----------------------------------------------------

const persona: Persona = { name: "Caller", systemPrompt: "You are a caller." };

test("branch fires the matching action based on the target's last utterance", async () => {
  const scn = scenario("Branching", persona)
    .branch([
      { when: "day|when", action: { kind: "say", text: "Tuesday please." } },
      { when: "bye|goodbye", action: { kind: "hangup" } },
    ])
    .build();

  const conductor = new Conductor(scn, { llm: new MockLLMClient() });
  const transcript: Transcript = [
    { role: "target", text: "What day works for you?", startedAt: 0 },
  ];
  const action = await conductor.next(transcript);
  assert.equal(action.kind, "speak");
  assert.equal((action as { text: string }).text, "Tuesday please.");
});

test("branch falls back when nothing matches", async () => {
  const scn = scenario("Branching", persona)
    .branch(
      [{ when: "never-matches-xyz", action: { kind: "say", text: "no" } }],
      { fallback: { kind: "hangup" } },
    )
    .build();
  const conductor = new Conductor(scn, { llm: new MockLLMClient() });
  const action = await conductor.next([{ role: "target", text: "hello", startedAt: 0 }]);
  assert.equal(action.kind, "hangup");
});

test("branch goto loop is bounded by maxVisits", async () => {
  // A branch that always gotos itself must terminate via the visit budget.
  const scn = scenario("Loop", persona)
    .branch([{ when: ".*", action: { kind: "goto", step: 0 } }], { maxVisits: 3 })
    .hangup()
    .build();
  const conductor = new Conductor(scn, { llm: new MockLLMClient() });
  const action = await conductor.next([{ role: "target", text: "anything", startedAt: 0 }]);
  // After exhausting the loop budget it advances to the hangup step.
  assert.equal(action.kind, "hangup");
});
