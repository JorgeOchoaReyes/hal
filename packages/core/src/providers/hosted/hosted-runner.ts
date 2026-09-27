import { JudgeSpec, TestResult, Transcript, RunStatus } from "../../types.js";
import { LLMClient } from "../../llm/client.js";
import { Judge } from "../../judge/judge.js";
import { computeMetrics, deriveLabels } from "../../metrics/metrics.js";
import { id, now } from "../../util/id.js";
import { sleep } from "../../util/events.js";
import {
  VoiceProviderIntegration,
  ProviderAccount,
  HostedTestingAgent,
  HostedTarget,
  HostedCallStatus,
  HostedCallState,
} from "./integration.js";

export interface HostedRunOptions {
  testCaseId: string;
  integration: VoiceProviderIntegration;
  account: ProviderAccount;
  agent: HostedTestingAgent;
  target: HostedTarget;
  judge: JudgeSpec;
  llm: LLMClient;
  /** Provider AI is the target when the target places the outbound call. */
  providerAgentRole?: "agent" | "target";
  pollIntervalMs?: number;
  timeoutMs?: number;
  /**
   * How the call is placed. Defaults to `integration.placeCall(account,
   * agent, target)` — the testing agent dials the target. Override to place
   * the call a different way (e.g. triggering another agent's own pathway
   * for the "agent under test is outbound" direction) while reusing the same
   * poll/judge/metrics pipeline.
   */
  place?: () => Promise<{ externalCallId: string }>;
}

export interface HostedRefreshOptions {
  result: TestResult;
  integration: VoiceProviderIntegration;
  account: ProviderAccount;
  judge: JudgeSpec;
  llm: LLMClient;
  providerAgentRole?: "agent" | "target";
}

/** Check a previously placed call once, without placing another call. */
export async function refreshHostedCall(opts: HostedRefreshOptions): Promise<{
  state: "in-progress" | "waiting-transcript" | "completed" | "failed" | "evaluation-failed";
  result?: TestResult;
}> {
  const callId = opts.result.externalCallId;
  if (!callId) throw new Error("This run has no provider call ID to check.");
  const state = await opts.integration.getCall(opts.account, callId);
  const side: "targetAgent" | "testingAgent" = opts.providerAgentRole === "target" ? "targetAgent" : "testingAgent";
  const captured: TestResult = {
    ...opts.result,
    providerCalls: state.details ? {
      ...opts.result.providerCalls,
      [side]: { provider: opts.account.provider, accountId: opts.account.id, externalCallId: callId,
        fetchedAt: now(), details: state.details, events: state.events },
    } : opts.result.providerCalls,
    trace: state.trace ? [...(opts.result.trace ?? []).filter((event) => event.side !== side),
      ...state.trace.map((event) => ({ ...event, side }))] : opts.result.trace,
  };
  if (state.status === "queued" || state.status === "in-progress") return { state: "in-progress", result: captured };
  const transcript = state.transcript
    ? normalizeTranscript(state.transcript, opts.providerAgentRole)
    : undefined;
  if (state.status === "failed") {
    return { state: "failed", result: {
      ...captured, status: "errored", endedAt: state.endedAt ?? now(),
      transcript: transcript ?? captured.transcript,
      error: state.endedReason || "Hosted call failed.",
    } };
  }
  if (!transcript?.length) return { state: "waiting-transcript", result: captured };
  try {
    const result = await scoreHostedResult({ ...captured, transcript, endedAt: state.endedAt ?? now() }, opts.judge, opts.llm);
    return { state: "completed", result };
  } catch (err) {
    return { state: "evaluation-failed", result: {
      ...captured, status: "errored", transcript, endedAt: state.endedAt ?? now(),
      verdict: undefined, metrics: undefined, labels: undefined,
      error: `Call completed, but evaluation failed: ${(err as Error).message}`,
    } };
  }
}

/**
 * Run a hosted call: place it (by default, the testing agent dials the
 * target — pass `place` to place it a different way), poll the platform
 * until it ends, then judge the returned transcript with the same Judge +
 * metrics pipeline as every other run. The hosted agent runs the conversation
 * itself (scripted via its system prompt), so there is no live turn-by-turn
 * control here — evaluation happens on the completed transcript.
 */
export async function runHostedCall(opts: HostedRunOptions): Promise<TestResult> {
  const runId = id("run");
  const startedAt = now();
  let externalCallId: string | undefined;
  let transcript: Transcript = [];
  let lastState: HostedCallState | undefined;

  try {
    const place = opts.place ?? (() => opts.integration.placeCall(opts.account, opts.agent, opts.target));
    const placed = await place();
    externalCallId = placed.externalCallId;

    const interval = opts.pollIntervalMs ?? 3000;
    const deadline = startedAt + (opts.timeoutMs ?? 300_000);
    let endedReason: string | undefined;
    let status: HostedCallStatus = "queued";

    while (now() < deadline) {
      const state = await opts.integration.getCall(opts.account, externalCallId);
      lastState = state;
      status = state.status;
      endedReason = state.endedReason;
      if (state.transcript) transcript = normalizeTranscript(state.transcript, opts.providerAgentRole);
      if (status === "ended" || status === "failed") break;
      await sleep(interval);
    }

    if (status === "failed") {
      return withCallData(errored(runId, opts.testCaseId, startedAt, transcript, externalCallId, endedReason || "hosted call failed"), opts, lastState);
    }

    if (status !== "ended") {
      return withCallData(errored(runId, opts.testCaseId, startedAt, transcript, externalCallId,
        "Timed out waiting for the hosted call to finish. The call may still be active; open this run’s details to check its status later."), opts, lastState);
    }
    if (!transcript.length) {
      return withCallData(errored(runId, opts.testCaseId, startedAt, transcript, externalCallId, "The provider returned no transcript for the completed call."), opts, lastState);
    }

    return scoreHostedResult(withCallData({
      id: runId,
      testCaseId: opts.testCaseId,
      status: "running",
      startedAt,
      endedAt: now(),
      transcript,
      liveChecks: [],
      externalCallId,
    }, opts, lastState), opts.judge, opts.llm);
  } catch (err) {
    return errored(runId, opts.testCaseId, startedAt, transcript, externalCallId, (err as Error).message);
  }
}

function withCallData(result: TestResult, opts: HostedRunOptions, state?: HostedCallState): TestResult {
  if (!state || !result.externalCallId) return result;
  const side = opts.providerAgentRole === "target" ? "targetAgent" : "testingAgent";
  return { ...result,
    providerCalls: state.details ? { [side]: { provider: opts.account.provider, accountId: opts.account.id,
      externalCallId: result.externalCallId, fetchedAt: now(), details: state.details, events: state.events } } : undefined,
    trace: state.trace?.map((event) => ({ ...event, side })),
  };
}

function normalizeTranscript(transcript: Transcript, providerAgentRole?: "agent" | "target"): Transcript {
  if (providerAgentRole !== "target") return transcript;
  return transcript.map((turn) => ({ ...turn,
    role: turn.role === "agent" ? "target" : turn.role === "target" ? "agent" : turn.role,
  }));
}

async function scoreHostedResult(result: TestResult, judge: JudgeSpec, llm: LLMClient): Promise<TestResult> {
  const verdict = await new Judge(llm).evaluate(judge, result.transcript);
  const status: RunStatus = verdict.passed ? "passed" : "failed";
  const scored: TestResult = { ...result, status, verdict, error: undefined };
  scored.metrics = computeMetrics(scored);
  scored.labels = deriveLabels(scored.metrics);
  return scored;
}

function errored(
  runId: string,
  testCaseId: string,
  startedAt: number,
  transcript: Transcript,
  externalCallId: string | undefined,
  error: string,
): TestResult {
  return {
    id: runId,
    testCaseId,
    status: "errored",
    startedAt,
    endedAt: now(),
    transcript,
    liveChecks: [],
    externalCallId,
    error,
  };
}
