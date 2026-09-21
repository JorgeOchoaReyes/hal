import { test } from "node:test";
import assert from "node:assert/strict";
import { HalEngine, MockLLMClient, bookingHappyPath } from "../index.js";

test("mock booking test case runs end-to-end and produces a verdict", async () => {
  const engine = new HalEngine({
    llm: new MockLLMClient(),
    mockTargetLlm: new MockLLMClient(),
    judgeLlm: new MockLLMClient(),
  });

  const result = await engine.runToCompletion(bookingHappyPath());

  assert.ok(result.transcript.length > 0, "should have a transcript");
  assert.ok(result.verdict, "should have a judge verdict");
  assert.ok(["passed", "failed"].includes(result.status), "should reach a terminal status");
  // The greeting is spoken by the target first.
  assert.equal(result.transcript[0]?.role, "target");
});

test("live assertions are recorded", async () => {
  const engine = new HalEngine({
    llm: new MockLLMClient(),
    mockTargetLlm: new MockLLMClient(),
    judgeLlm: new MockLLMClient(),
  });
  const result = await engine.runToCompletion(bookingHappyPath());
  assert.ok(result.liveChecks.length >= 1, "should evaluate at least one live assertion");
});
