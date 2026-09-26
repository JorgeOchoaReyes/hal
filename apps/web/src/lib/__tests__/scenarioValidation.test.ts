import { test } from "node:test";
import assert from "node:assert/strict";
import { validateScenario } from "../scenarioValidation";
const scenario = { persona: { name: "Tester", systemPrompt: "Be polite" }, steps: [{ kind: "say", text: "Hello" }, { kind: "hangup" }] };
test("scenario edits validate steps and conditions before saving", () => {
  assert.equal(validateScenario(scenario), undefined);
  for (const steps of [[{ kind: "say", text: "" }], [{ kind: "wait", until: "[" }], [{ kind: "branch", branches: [{ when: "yes", action: { kind: "goto", step: 100 } }] }], [{ kind: "other" }]]) assert(validateScenario({ ...scenario, steps }));
  assert(validateScenario({ ...scenario, structured: { role: "Tester", conditions: [{ id: 2, action: "Hi" }] } }))
});
