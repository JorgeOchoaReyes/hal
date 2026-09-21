import {
  Scenario,
  ScenarioStep,
  Persona,
  LiveAssertion,
  ConditionalBranch,
  BranchAction,
} from "../types.js";
import { id } from "../util/id.js";

/**
 * Fluent builder for scenarios so tests and the API can compose turn-by-turn
 * scripts readably:
 *
 *   scenario("Booking happy path", persona)
 *     .say("Hi, I'd like to book an appointment.")
 *     .expect({ id: "offers-slot", description: "offers a day", matches: "day|when" })
 *     .prompt("Pick the first day offered and confirm.")
 *     .say("No, that's all. Thanks!")
 *     .hangup()
 *     .build();
 */
export class ScenarioBuilder {
  private steps: ScenarioStep[] = [];
  private _maxTurns?: number;
  private _maxDurationMs?: number;

  constructor(
    private readonly name: string,
    private readonly persona: Persona,
    private readonly description?: string,
  ) {}

  say(text: string, delayMs?: number): this {
    this.steps.push({ kind: "say", text, delayMs });
    return this;
  }

  prompt(directive: string, maxTurns?: number): this {
    this.steps.push({ kind: "prompt", directive, maxTurns });
    return this;
  }

  wait(opts: { timeoutMs?: number; until?: string } = {}): this {
    this.steps.push({ kind: "wait", ...opts });
    return this;
  }

  expect(assertion: LiveAssertion): this {
    this.steps.push({ kind: "expect", assertion });
    return this;
  }

  hangup(): this {
    this.steps.push({ kind: "hangup" });
    return this;
  }

  /** Add a conditional-action (branch) step: if target says X, do Y. */
  branch(
    branches: ConditionalBranch[],
    opts: { fallback?: BranchAction; maxVisits?: number } = {},
  ): this {
    this.steps.push({ kind: "branch", branches, ...opts });
    return this;
  }

  maxTurns(n: number): this {
    this._maxTurns = n;
    return this;
  }

  maxDurationMs(ms: number): this {
    this._maxDurationMs = ms;
    return this;
  }

  build(): Scenario {
    return {
      id: id("scn"),
      name: this.name,
      description: this.description,
      persona: this.persona,
      steps: this.steps,
      maxTurns: this._maxTurns,
      maxDurationMs: this._maxDurationMs,
    };
  }
}

export function scenario(name: string, persona: Persona, description?: string): ScenarioBuilder {
  return new ScenarioBuilder(name, persona, description);
}
