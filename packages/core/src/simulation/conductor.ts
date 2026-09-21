import {
  Scenario,
  ScenarioStep,
  Transcript,
  CheckResult,
  LiveAssertion,
} from "../types.js";
import { LLMClient, ChatMessage } from "../llm/client.js";

/**
 * The next thing the HAL testing agent should do on its turn.
 */
export type AgentAction =
  | { kind: "speak"; text: string; delayMs?: number }
  | { kind: "wait"; timeoutMs?: number; until?: string }
  | { kind: "hangup"; reason: string };

export interface ConductorDeps {
  llm: LLMClient;
}

/**
 * Conductor drives a Scenario turn-by-turn. It owns a cursor over the
 * scenario steps and, given the transcript so far, decides the agent's next
 * action. "say" steps are deterministic; "prompt" steps delegate to the
 * persona LLM so a tester can mix scripted control with dynamic behaviour.
 *
 * It also evaluates inline `expect` assertions against the latest target turn,
 * emitting live CheckResults that the runner surfaces immediately.
 */
export class Conductor {
  private cursor = 0;
  /** Turns already emitted for the current in-progress "prompt" step. */
  private promptTurns = 0;
  /** Visit count per branch step index, to bound decision-tree loops. */
  private branchVisits = new Map<number, number>();

  constructor(
    private readonly scenario: Scenario,
    private readonly deps: ConductorDeps,
  ) {}

  get finished(): boolean {
    return this.cursor >= this.scenario.steps.length;
  }

  /**
   * Evaluate every `expect` assertion that sits at the current cursor position,
   * against the latest target utterance. Returns the live check results and
   * whether any *fatal* assertion failed (which should abort the call).
   */
  evaluateLiveAssertions(transcript: Transcript): {
    checks: CheckResult[];
    abort: boolean;
  } {
    const checks: CheckResult[] = [];
    let abort = false;
    const lastTarget = [...transcript].reverse().find((u) => u.role === "target");

    while (this.cursor < this.scenario.steps.length) {
      const step = this.scenario.steps[this.cursor]!;
      if (step.kind !== "expect") break;
      const result = evaluateAssertion(step.assertion, lastTarget);
      checks.push(result);
      if (!result.passed && step.assertion.fatal) abort = true;
      this.cursor++;
    }
    return { checks, abort };
  }

  /**
   * Compute the agent's next action. Assumes `evaluateLiveAssertions` has
   * already consumed any leading `expect` steps.
   */
  async next(transcript: Transcript): Promise<AgentAction> {
    if (this.finished) {
      return { kind: "hangup", reason: "scenario complete" };
    }

    const step = this.scenario.steps[this.cursor]!;
    switch (step.kind) {
      case "say":
        this.cursor++;
        return { kind: "speak", text: step.text, delayMs: step.delayMs };

      case "wait":
        this.cursor++;
        return { kind: "wait", timeoutMs: step.timeoutMs, until: step.until };

      case "hangup":
        this.cursor++;
        return { kind: "hangup", reason: "scripted hangup" };

      case "prompt": {
        const text = await this.generatePersonaReply(step, transcript);
        this.promptTurns++;
        const cap = step.maxTurns ?? 1;
        if (this.promptTurns >= cap) {
          this.cursor++;
          this.promptTurns = 0;
        }
        return { kind: "speak", text };
      }

      case "branch":
        return this.handleBranch(step, transcript);

      case "expect":
        // Should have been consumed by evaluateLiveAssertions; skip defensively.
        this.cursor++;
        return this.next(transcript);
    }
  }

  /** Evaluate a conditional-action (branch) step against the latest target turn. */
  private async handleBranch(
    step: Extract<ScenarioStep, { kind: "branch" }>,
    transcript: Transcript,
  ): Promise<AgentAction> {
    const idx = this.cursor;
    const visits = (this.branchVisits.get(idx) ?? 0) + 1;
    this.branchVisits.set(idx, visits);
    if (visits > (step.maxVisits ?? 25)) {
      this.cursor++; // loop budget exhausted; move on
      return this.next(transcript);
    }

    const lastTarget = [...transcript].reverse().find((u) => u.role === "target");
    const text = lastTarget?.text ?? "";
    const match = step.branches.find((b) => {
      try {
        return new RegExp(b.when, "i").test(text);
      } catch {
        return false;
      }
    });
    const action = match?.action ?? step.fallback;
    if (!action) {
      this.cursor++;
      return this.next(transcript);
    }
    return this.applyBranchAction(action, transcript);
  }

  private async applyBranchAction(
    action: Extract<ScenarioStep, { kind: "branch" }>["branches"][number]["action"],
    transcript: Transcript,
  ): Promise<AgentAction> {
    switch (action.kind) {
      case "say":
        this.cursor++;
        return { kind: "speak", text: action.text };
      case "prompt": {
        this.cursor++;
        const text = await this.generatePersonaReply(
          { kind: "prompt", directive: action.directive },
          transcript,
        );
        return { kind: "speak", text };
      }
      case "goto":
        this.cursor = Math.max(0, Math.min(this.scenario.steps.length, action.step));
        return this.next(transcript);
      case "hangup":
        this.cursor++;
        return { kind: "hangup", reason: "branch hangup" };
    }
  }

  private async generatePersonaReply(
    step: Extract<ScenarioStep, { kind: "prompt" }>,
    transcript: Transcript,
  ): Promise<string> {
    const { persona } = this.scenario;
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          `${persona.systemPrompt}\n\n` +
          `You are the CALLER in a phone conversation. You are testing the ` +
          `voice AI on the other end. Stay in character. Reply with only what ` +
          `you would say out loud — no stage directions, no quotes.\n\n` +
          `Current objective for this turn: ${step.directive}`,
      },
      // Replay the conversation, mapping roles to the caller's perspective.
      ...transcript.map<ChatMessage>((u) => ({
        role: u.role === "agent" ? "assistant" : "user",
        content: u.text,
      })),
    ];

    const reply = await this.deps.llm.complete({
      messages,
      temperature: persona.temperature ?? 0.7,
      maxTokens: 200,
    });
    return reply || "Sorry, could you repeat that?";
  }
}

function evaluateAssertion(
  assertion: LiveAssertion,
  lastTarget: Transcript[number] | undefined,
): CheckResult {
  const base = { id: assertion.id, description: assertion.description };

  if (!lastTarget) {
    return { ...base, passed: false, detail: "No target utterance to check yet." };
  }

  if (assertion.matches) {
    const re = new RegExp(assertion.matches, "i");
    if (!re.test(lastTarget.text)) {
      return {
        ...base,
        passed: false,
        detail: `Expected target reply to match /${assertion.matches}/i, got: "${lastTarget.text}"`,
      };
    }
  }

  if (assertion.maxLatencyMs != null && lastTarget.latencyMs != null) {
    if (lastTarget.latencyMs > assertion.maxLatencyMs) {
      return {
        ...base,
        passed: false,
        detail: `Target latency ${lastTarget.latencyMs}ms exceeded limit ${assertion.maxLatencyMs}ms`,
      };
    }
  }

  return { ...base, passed: true };
}
