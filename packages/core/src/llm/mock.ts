import { LLMClient, CompletionRequest } from "./client.js";

/**
 * Deterministic LLM used for offline development, tests, and the default
 * "no API key" experience. It produces plausible, canned conversational
 * replies driven by simple keyword heuristics so the whole HAL pipeline can be
 * exercised end-to-end with zero external dependencies.
 */
export class MockLLMClient implements LLMClient {
  readonly name = "mock";
  readonly defaultModel = "mock-1";

  constructor(private readonly opts: { seedReplies?: string[] } = {}) {}

  private turn = 0;

  async complete(req: CompletionRequest): Promise<string> {
    const last = [...req.messages].reverse().find((m) => m.role !== "system");
    const text = (last?.content ?? "").toLowerCase();
    const system = req.messages.find((m) => m.role === "system")?.content ?? "";

    // If the caller wants JSON (the judge), return a valid verdict shape.
    if (req.json) {
      const passed = !/fail|angry|wrong|error/.test(text);
      return JSON.stringify({
        passed,
        score: passed ? 0.82 : 0.31,
        summary: passed
          ? "Mock judge: the conversation met the stated criteria."
          : "Mock judge: the conversation did not meet the stated criteria.",
        checks: [],
      });
    }

    if (this.opts.seedReplies && this.turn < this.opts.seedReplies.length) {
      return this.opts.seedReplies[this.turn++]!;
    }
    this.turn++;

    // Mock "target" behaviour: greet, then respond to intents.
    if (/^\s*$/.test(text)) {
      return "Hello, thanks for calling. How can I help you today?";
    }
    if (/book|appointment|schedule|reserve/.test(text)) {
      return "Sure, I can help you book an appointment. What day works best for you?";
    }
    if (/monday|tuesday|wednesday|thursday|friday|tomorrow|today/.test(text)) {
      return "Great, I've booked that for you and sent a confirmation. Anything else?";
    }
    if (/no|that's all|nothing|bye|goodbye/.test(text)) {
      return "Thank you for calling. Have a great day!";
    }
    if (/hours|open|location|address/.test(text)) {
      return "We're open Monday to Friday, nine to five, at 100 Main Street.";
    }
    if (system.includes("customer")) {
      return "Okay, that works for me.";
    }
    return "I understand. Could you tell me a little more about what you need?";
  }
}
