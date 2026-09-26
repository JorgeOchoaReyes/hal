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
      status = state.status;
      endedReason = state.endedReason;
      if (state.transcript) transcript = state.transcript.map((turn) => ({
        ...turn,
        role: opts.providerAgentRole === "target"
          ? turn.role === "agent" ? "target" : turn.role === "target" ? "agent" : turn.role
          : turn.role,
      }));
      if (status === "ended" || status === "failed") break;
      await sleep(interval);
    }

    if (status === "failed") {
      return errored(runId, opts.testCaseId, startedAt, transcript, externalCallId, endedReason || "hosted call failed");
    }

    if (status !== "ended") {
      return errored(runId, opts.testCaseId, startedAt, transcript, externalCallId,
        "Timed out waiting for the hosted call to finish. The call may still be active; check it in the provider dashboard.");
    }
    if (!transcript.length) {
      return errored(runId, opts.testCaseId, startedAt, transcript, externalCallId, "The provider returned no transcript for the completed call.");
    }

    const verdict = await new Judge(opts.llm).evaluate(opts.judge, transcript);
    const runStatus: RunStatus = verdict.passed ? "passed" : "failed";
    const result: TestResult = {
      id: runId,
      testCaseId: opts.testCaseId,
      status: runStatus,
      startedAt,
      endedAt: now(),
      transcript,
      verdict,
      liveChecks: [],
      externalCallId,
    };
    result.metrics = computeMetrics(result);
    result.labels = deriveLabels(result.metrics);
    return result;
  } catch (err) {
    return errored(runId, opts.testCaseId, startedAt, transcript, externalCallId, (err as Error).message);
  }
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
