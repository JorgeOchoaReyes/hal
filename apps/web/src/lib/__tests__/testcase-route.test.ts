import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { TestCase, Scenario } from "@hal/core";
import { validateScenario } from "../scenarioValidation";

// Execute the actual route with an isolated synchronous store. Deferred request
// bodies reproduce overlapping requests without timing sleeps or a live server.
const source = readFileSync(new URL("../../app/api/testcases/[id]/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup() {
  let saved: TestCase = {
    id: "tc1", name: "Test",
    target: { transport: "mock", name: "Target", mock: { systemPrompt: "Help the tester", greeting: "Hello" } },
    scenario: { id: "scenario1", name: "Test", persona: { name: "Tester", systemPrompt: "Test" }, steps: [{ kind: "say", text: "original" }] },
    judge: { mode: "rules-only" }, judgeIds: [],
  };
  const store = {
    getTestCase: () => saved,
    getTestCaseRaw: () => saved,
    upsertTestCase: (tc: TestCase) => { saved = tc; },
  };
  type Patch = (req: { json: () => Promise<unknown> }, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  const context = { exports: {} as { PATCH: Patch }, require: (name: string) => {
    if (name === "next/server") return { NextResponse: Response };
    if (name === "@/lib/store") return store;
    if (name === "@/lib/scenarioValidation") return { validateScenario };
    throw new Error(`Unexpected route dependency: ${name}`);
  } };
  runInNewContext(compiled, context);
  return {
    saved: () => saved,
    patch: (body: Promise<unknown>) => context.exports.PATCH({ json: () => body }, { params: Promise.resolve({ id: "tc1" }) }),
  };
}

function edit(original: Scenario, text: string): Scenario {
  return { ...original, steps: [{ kind: "say", text }] };
}

test("an overlapping stale scenario save returns 409 instead of overwriting the newer edit", async () => {
  const h = setup();
  const original = structuredClone(h.saved().scenario);
  let release!: (body: unknown) => void;
  const slow = h.patch(new Promise(resolve => { release = resolve; }));
  const newer = edit(original, "newer edit");
  const fast = await h.patch(Promise.resolve({ scenario: newer, expectedScenario: original }));
  assert.equal(fast.status, 200);
  release({ scenario: edit(original, "stale edit"), expectedScenario: original });
  assert.equal((await slow).status, 409);
  assert.deepEqual(h.saved().scenario.steps, newer.steps);
});

test("overlapping scenario and judge saves preserve both changes in either order", async () => {
  for (const slowScenario of [true, false]) {
    const h = setup();
    const original = structuredClone(h.saved().scenario);
    const newer = edit(original, "updated script");
    const scenarioBody = { scenario: newer, expectedScenario: original };
    const judgeBody = { judgeIds: ["judge1"] };
    let release!: (body: unknown) => void;
    const slow = h.patch(new Promise(resolve => { release = resolve; }));
    assert.equal((await h.patch(Promise.resolve(slowScenario ? judgeBody : scenarioBody))).status, 200);
    release(slowScenario ? scenarioBody : judgeBody);
    assert.equal((await slow).status, 200);
    assert.deepEqual(h.saved().scenario.steps, newer.steps);
    assert.deepEqual(h.saved().judgeIds, ["judge1"]);
  }
});
