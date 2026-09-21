import { Transcript, CheckResult } from "../types.js";
import { LLMClient, ChatMessage } from "../llm/client.js";
import { AgentAction, ConductorLike, ConductorDeps } from "./conductor.js";
import { StructuredTest, StructuredCondition, FIRST_MESSAGE, renderFixedMessage } from "./structured.js";

/**
 * Drives a Structured Test turn by turn, producing the same AgentAction stream
 * the runner consumes for linear scenarios.
 */
export class StructuredConductor implements ConductorLike {
  private fired = new Set<number>();
  private lastFiredId: number | null = null;
  private done = false;
  private stalls = 0;

  constructor(
    private readonly test: StructuredTest,
    private readonly deps: ConductorDeps,
  ) {}

  get finished(): boolean {
    return this.done;
  }

  // Structured tests carry their assertions as metrics; no live expect steps.
  evaluateLiveAssertions(): { checks: CheckResult[]; abort: boolean } {
    return { checks: [], abort: false };
  }

  async next(transcript: Transcript): Promise<AgentAction> {
    // 1. FIRST_MESSAGE (id 0) opens the conversation.
    if (!this.fired.has(0)) {
      const first = this.byId(0);
      this.fired.add(0);
      this.lastFiredId = 0;
      if (first && first.action.trim()) {
        return this.fire(first, transcript);
      }
      // Empty FIRST_MESSAGE: the main agent speaks first — fall through to match.
    }

    // 2. An action_followup on the most recently fired condition fires next.
    const followup = this.test.conditions.find(
      (c) => c.type === "action_followup" && c.condition === this.lastFiredId && !this.fired.has(c.id),
    );
    if (followup) {
      this.fired.add(followup.id);
      this.lastFiredId = followup.id;
      this.stalls = 0;
      return this.fire(followup, transcript);
    }

    // 3. Standard conditions matched against the main agent's latest turn.
    const candidates = this.test.conditions.filter(
      (c) => c.type === "standard" && c.id !== 0 && !this.fired.has(c.id),
    );
    if (candidates.length > 0) {
      const matchId = await this.matchCondition(candidates, transcript);
      const matched = candidates.find((c) => c.id === matchId);
      if (matched) {
        this.fired.add(matched.id);
        this.lastFiredId = matched.id;
        this.stalls = 0;
        return this.fire(matched, transcript);
      }
    }

    // 4. Nothing to fire. If everything is done, hang up; else wait for more.
    const remaining = this.test.conditions.filter((c) => c.id !== 0 && !this.fired.has(c.id));
    if (remaining.length === 0 || this.stalls >= 3) {
      this.done = true;
      return { kind: "hangup", reason: "structured test complete" };
    }
    this.stalls++;
    return { kind: "wait", timeoutMs: 15000 };
  }

  private byId(id: number): StructuredCondition | undefined {
    return this.test.conditions.find((c) => c.id === id);
  }

  private async fire(c: StructuredCondition, transcript: Transcript): Promise<AgentAction> {
    if (c.fixed_message) {
      const { text, endCall } = renderFixedMessage(c.action);
      if (endCall) this.done = true;
      // A pure-tag action (e.g. <endcall/>) may render to empty text.
      if (!text) return this.done ? { kind: "hangup", reason: "endcall" } : { kind: "wait" };
      return { kind: "speak", text };
    }
    const text = await this.generateReply(c.action, transcript);
    return { kind: "speak", text };
  }

  /** Ask the LLM which candidate condition the agent's latest turn triggers. */
  private async matchCondition(
    candidates: StructuredCondition[],
    transcript: Transcript,
  ): Promise<number> {
    const lastTarget = [...transcript].reverse().find((u) => u.role === "target");
    if (!lastTarget) return -1;
    const list = candidates.map((c) => `id ${c.id}: ${c.condition}`).join("\n");
    const prompt =
      `You route a test conversation. Role: ${this.test.role}\n\n` +
      `The other party (the agent under test) just said:\n"${lastTarget.text}"\n\n` +
      `Which of these conditions does that trigger? Reply with JSON {"id": <number>} ` +
      `using the matching id, or {"id": -1} if none clearly match.\n${list}`;
    try {
      const raw = await this.deps.llm.complete({
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        maxTokens: 50,
        json: true,
      });
      const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw) as { id?: number };
      return typeof parsed.id === "number" ? parsed.id : -1;
    } catch {
      return -1;
    }
  }

  private async generateReply(directive: string, transcript: Transcript): Promise<string> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          `${this.test.role}\n\n` +
          `You are the CALLER testing a voice AI. Stay in character and reply with ` +
          `only what you would say out loud. Objective for this turn: ${directive}`,
      },
      ...transcript.map<ChatMessage>((u) => ({
        role: u.role === "agent" ? "assistant" : "user",
        content: u.text,
      })),
    ];
    const reply = await this.deps.llm.complete({ messages, temperature: 0.6, maxTokens: 200 });
    return reply || "Okay.";
  }
}
