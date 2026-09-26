import {
  TestCase,
  TestResult,
  Transcript,
  Utterance,
  CheckResult,
  RunEvent,
  RunStatus,
} from "../types.js";
import { CallTransport } from "../transport/transport.js";
import { Conductor, ConductorLike } from "../simulation/conductor.js";
import { StructuredConductor } from "../simulation/structured-conductor.js";
import { Judge } from "../judge/judge.js";
import { LLMClient } from "../llm/client.js";
import { TypedEmitter, sleep } from "../util/events.js";
import { id, now } from "../util/id.js";
import { computeMetrics, deriveLabels } from "../metrics/metrics.js";

export interface RunnerDeps {
  /** Resolve the transport for a given target transport kind. */
  resolveTransport: (kind: TestCase["target"]["transport"]) => CallTransport;
  /** LLM used by the persona (conductor) and, unless overridden, the judge. */
  llm: LLMClient;
  /** LLM used by the judge; defaults to `llm`. */
  judgeLlm?: LLMClient;
}

export interface RunHandle {
  result: Promise<TestResult>;
  events: TypedEmitter<RunEvent>;
  abort: () => void;
}

/**
 * Executes a single TestCase: establishes the call, runs the scenario turn by
 * turn, evaluates live assertions, then judges the transcript. Streams
 * everything as RunEvents so a UI can render the call as it happens.
 */
export class TestRunner {
  constructor(private readonly deps: RunnerDeps) {}

  run(testCase: TestCase): RunHandle {
    const events = new TypedEmitter<RunEvent>();
    let aborted = false;
    const abort = () => {
      aborted = true;
    };

    const result = this.execute(testCase, events, () => aborted).catch(
      (err): TestResult => ({
        id: id("run"),
        testCaseId: testCase.id,
        status: "errored",
        startedAt: now(),
        endedAt: now(),
        transcript: [],
        liveChecks: [],
        error: (err as Error).message,
      }),
    );

    return { result, events, abort };
  }

  private async execute(
    testCase: TestCase,
    events: TypedEmitter<RunEvent>,
    isAborted: () => boolean,
  ): Promise<TestResult> {
    const runId = id("run");
    const startedAt = now();
    const transcript: Transcript = [];
    const liveChecks: CheckResult[] = [];

    const setStatus = (status: RunStatus) =>
      events.emit({ type: "status", status, at: now() });
    const record = (u: Utterance) => {
      transcript.push(u);
      events.emit({ type: "utterance", utterance: u });
    };
    const log = (level: "info" | "warn" | "error", message: string) =>
      events.emit({ type: "log", level, message, at: now() });

    setStatus("running");

    const transport = this.deps.resolveTransport(testCase.target.transport);
    const conductor: ConductorLike = testCase.scenario.structured
      ? new StructuredConductor(testCase.scenario.structured, { llm: this.deps.llm })
      : new Conductor(testCase.scenario, { llm: this.deps.llm });
    const maxTurns = testCase.scenario.maxTurns ?? 40;
    const deadline = testCase.scenario.maxDurationMs
      ? startedAt + testCase.scenario.maxDurationMs
      : Infinity;

    let externalCallId: string | undefined;
    let status: RunStatus = "running";
    let error: string | undefined;

    const session = await transport.connect(testCase.target);
    externalCallId = session.externalId;
    log("info", `Connected via ${testCase.target.transport} (${externalCallId ?? "n/a"})`);

    try {
      // Capture an opening greeting from the target, if it speaks first.
      const greeting = await session.listen({ timeoutMs: 4000 });
      if (greeting) record(greeting);

      while (!conductor.finished) {
        if (isAborted()) {
          status = "aborted";
          break;
        }
        if (now() > deadline) {
          log("warn", "Max duration reached; ending call.");
          break;
        }
        if (transcript.length >= maxTurns) {
          log("warn", "Max turns reached; ending call.");
          break;
        }

        // Live assertions consume any leading `expect` steps.
        const live = conductor.evaluateLiveAssertions(transcript);
        for (const check of live.checks) {
          liveChecks.push(check);
          events.emit({ type: "live-check", check });
        }
        if (live.abort) {
          log("error", "Fatal live assertion failed; aborting call.");
          status = "failed";
          break;
        }

        // The final reply has been recorded and its assertions evaluated. Do
        // not send another script line to a peer that has already finished.
        if (session.completed) {
          log("info", "Target ended the conversation.");
          break;
        }

        const action = await conductor.next(transcript);

        if (action.kind === "hangup") {
          log("info", `Agent hangup: ${action.reason}`);
          break;
        }

        if (action.kind === "speak") {
          if (action.delayMs) await sleep(action.delayMs);
          const startedSpeak = now();
          await session.speak(action.text);
          record({
            role: "agent",
            text: action.text,
            startedAt: startedSpeak,
            endedAt: now(),
          });
          const reply = await session.listen({ timeoutMs: 15000 });
          if (reply) record(reply);
          else log("warn", "No target reply before timeout.");
          continue;
        }

        if (action.kind === "wait") {
          const reply = await this.listenUntil(session, action.timeoutMs, action.until);
          if (reply) record(reply);
          else log("warn", "Wait step timed out with no matching reply.");
        }
      }
    } catch (err) {
      status = isAborted() ? "aborted" : "errored";
      error = (err as Error).message;
    } finally {
      await session.hangup("run complete").catch(() => undefined);
    }

    // Judge the final transcript (unless we errored/aborted out).
    const judge = new Judge(this.deps.judgeLlm ?? this.deps.llm);
    let verdict: TestResult["verdict"];
    if (status !== "aborted" && status !== "errored") {
      try {
        verdict = await judge.evaluate(testCase.judge, transcript);
      } catch (err) {
        status = "errored";
        error = (err as Error).message;
      }
    }
    if (verdict) events.emit({ type: "verdict", verdict });

    const livePassed = liveChecks.every((c) => c.passed);
    if (status === "running") {
      status = verdict ? (verdict.passed && livePassed ? "passed" : "failed") : "failed";
    } else if (status === "failed" && verdict?.passed && livePassed) {
      // A fatal live assertion already set failed; keep it failed.
      status = "failed";
    }

    const result: TestResult = {
      id: runId,
      testCaseId: testCase.id,
      status,
      startedAt,
      endedAt: now(),
      transcript,
      verdict,
      liveChecks,
      externalCallId,
      error,
    };
    result.metrics = computeMetrics(result);
    result.labels = deriveLabels(result.metrics);

    setStatus(status);
    events.emit({ type: "done", result });
    return result;
  }

  /** Listen repeatedly within one wait step until `until` matches or timeout. */
  private async listenUntil(
    session: Awaited<ReturnType<CallTransport["connect"]>>,
    timeoutMs = 15000,
    until?: string,
  ): Promise<Utterance | null> {
    const re = until ? new RegExp(until, "i") : undefined;
    const end = now() + timeoutMs;
    while (now() < end) {
      const remaining = end - now();
      const reply = await session.listen({ timeoutMs: remaining });
      if (!reply) return null;
      if (!re || re.test(reply.text)) return reply;
      // else keep waiting for a matching reply within the budget
    }
    return null;
  }
}
