import { CallSession, CallTransport, TransportError } from "./transport.js";
import { Target, Utterance } from "../types.js";
import { LLMClient, ChatMessage } from "../llm/client.js";
import { now, id } from "../util/id.js";
import { sleep } from "../util/events.js";

/**
 * A fully in-process transport: the "target voice AI" is simulated by an LLM
 * (the mock LLM by default, or a real one if configured). This lets HAL be
 * developed, demoed, and tested end-to-end with no telephony, no audio stack,
 * and no external system under test. It is also the fastest way to smoke-test a
 * scenario before pointing it at a real number.
 */
export class MockTransport implements CallTransport {
  readonly kind = "mock" as const;

  constructor(
    private readonly llm: LLMClient,
    private readonly opts: { simulatedLatencyMs?: number } = {},
  ) {}

  async connect(target: Target): Promise<CallSession> {
    if (target.transport !== "mock") {
      throw new TransportError("MockTransport requires a mock target", this.kind);
    }
    return new MockSession(this.llm, target.mock, this.opts.simulatedLatencyMs ?? 150);
  }
}

class MockSession implements CallSession {
  readonly externalId = id("mock-call");
  private history: ChatMessage[];
  private open = true;
  private lastTurnEndedAt = now();
  private greetingPending: string | undefined;

  constructor(
    private readonly llm: LLMClient,
    mock: { systemPrompt: string; greeting?: string },
    private readonly latencyMs: number,
  ) {
    this.history = [
      {
        role: "system",
        content:
          `${mock.systemPrompt}\n\n` +
          `You are a voice AI agent answering a phone call. Respond naturally ` +
          `and concisely, as you would speak out loud. Do not use markdown.`,
      },
    ];
    this.greetingPending = mock.greeting;
  }

  async speak(text: string): Promise<void> {
    if (!this.open) return;
    this.history.push({ role: "user", content: text });
    this.lastTurnEndedAt = now();
  }

  async listen(opts?: { timeoutMs?: number }): Promise<Utterance | null> {
    if (!this.open) return null;

    // Deliver the greeting as the target's very first turn.
    if (this.greetingPending) {
      const text = this.greetingPending;
      this.greetingPending = undefined;
      return this.finishTurn(text);
    }

    await sleep(this.latencyMs);
    const reply = await this.llm.complete({
      messages: this.history,
      temperature: 0.6,
      maxTokens: 200,
    });
    if (!reply) return null;
    this.history.push({ role: "assistant", content: reply });
    return this.finishTurn(reply);
  }

  private finishTurn(text: string): Utterance {
    const startedAt = now();
    const latencyMs = startedAt - this.lastTurnEndedAt;
    const utt: Utterance = {
      role: "target",
      text,
      startedAt,
      endedAt: now(),
      latencyMs,
      meta: { simulated: true },
    };
    this.lastTurnEndedAt = utt.endedAt!;
    return utt;
  }

  async hangup(): Promise<void> {
    this.open = false;
  }
}
