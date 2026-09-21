import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateStructuredTest,
  renderFixedMessage,
  StructuredConductor,
  MockLLMClient,
  type StructuredTest,
  type Transcript,
  type LLMClient,
} from "../index.js";

test("validation enforces Cekura's structured-test rules", () => {
  const valid: StructuredTest = {
    role: "You are a patient cancelling an appointment",
    conditions: [
      { id: 0, condition: "FIRST_MESSAGE", action: "Hi, I need to cancel.", type: "standard", fixed_message: true },
      { id: 1, condition: "The agent asks for your name", action: "Provide your name", type: "standard", fixed_message: false },
    ],
  };
  assert.deepEqual(validateStructuredTest(valid), []);

  // Missing FIRST_MESSAGE.
  assert.ok(
    validateStructuredTest({
      role: "x",
      conditions: [{ id: 0, condition: "", action: "Hi", type: "standard", fixed_message: true }],
    }).some((e) => e.includes("FIRST_MESSAGE")),
  );

  // Duplicate ids.
  assert.ok(
    validateStructuredTest({
      role: "x",
      conditions: [
        { id: 0, condition: "FIRST_MESSAGE", action: "Hi", type: "standard", fixed_message: true },
        { id: 1, condition: "a", action: "x", type: "standard", fixed_message: false },
        { id: 1, condition: "b", action: "y", type: "standard", fixed_message: false },
      ],
    }).some((e) => e.includes("duplicate")),
  );

  // action_followup referencing unknown id.
  assert.ok(
    validateStructuredTest({
      role: "x",
      conditions: [
        { id: 0, condition: "FIRST_MESSAGE", action: "Hi", type: "standard", fixed_message: true },
        { id: 1, condition: 9, action: "x", type: "action_followup", fixed_message: true },
      ],
    }).some((e) => e.includes("unknown id")),
  );

  // Empty action on a non-first condition.
  assert.ok(
    validateStructuredTest({
      role: "x",
      conditions: [
        { id: 0, condition: "FIRST_MESSAGE", action: "Hi", type: "standard", fixed_message: true },
        { id: 1, condition: "a", action: "  ", type: "standard", fixed_message: false },
      ],
    }).some((e) => e.includes("action cannot be empty")),
  );
});

test("renderFixedMessage strips tags and detects endcall", () => {
  assert.deepEqual(renderFixedMessage("Thanks <endcall />"), { text: "Thanks", endCall: true });
  assert.deepEqual(renderFixedMessage("My code is <spell>ABC</spell>"), {
    text: "My code is A B C",
    endCall: false,
  });
  assert.deepEqual(renderFixedMessage("Wait <silence time=\"2s\" /> ok"), {
    text: "Wait ok",
    endCall: false,
  });
});

test("structured conductor emits FIRST_MESSAGE then a scripted action_followup", async () => {
  const test: StructuredTest = {
    role: "You are updating your address",
    conditions: [
      { id: 0, condition: "FIRST_MESSAGE", action: "Hi, I need to update my address", type: "standard", fixed_message: true },
      { id: 1, condition: 0, action: "My street is 123 Main Street", type: "action_followup", fixed_message: true },
      { id: 2, condition: 1, action: "Thanks <endcall />", type: "action_followup", fixed_message: true },
    ],
  };
  const conductor = new StructuredConductor(test, { llm: new MockLLMClient() });
  const transcript: Transcript = [];

  const a0 = await conductor.next(transcript);
  assert.equal(a0.kind, "speak");
  assert.equal((a0 as { text: string }).text, "Hi, I need to update my address");

  transcript.push({ role: "agent", text: (a0 as { text: string }).text, startedAt: 0 });
  transcript.push({ role: "target", text: "Sure, go ahead.", startedAt: 1 });

  const a1 = await conductor.next(transcript);
  assert.equal((a1 as { text: string }).text, "My street is 123 Main Street");

  transcript.push({ role: "agent", text: "My street is 123 Main Street", startedAt: 2 });
  transcript.push({ role: "target", text: "Got it.", startedAt: 3 });

  const a2 = await conductor.next(transcript);
  assert.equal((a2 as { text: string }).text, "Thanks");
  assert.equal(conductor.finished, true, "endcall marks the test complete");
});

test("structured conductor fires the standard condition the matcher selects", async () => {
  // A fake LLM that always routes to condition id 1.
  const routing: LLMClient = {
    name: "route",
    defaultModel: "x",
    async complete() {
      return JSON.stringify({ id: 1 });
    },
  };
  const test: StructuredTest = {
    role: "caller",
    conditions: [
      { id: 0, condition: "FIRST_MESSAGE", action: "", type: "standard", fixed_message: true },
      { id: 1, condition: "The agent asks for your name", action: "John Smith", type: "standard", fixed_message: true },
    ],
  };
  const conductor = new StructuredConductor(test, { llm: routing });
  const transcript: Transcript = [{ role: "target", text: "What's your name?", startedAt: 0 }];
  // id 0 has empty action, so the first next() falls through to matching.
  const action = await conductor.next(transcript);
  assert.equal((action as { text: string }).text, "John Smith");
});
