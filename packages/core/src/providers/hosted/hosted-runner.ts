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
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/**
 * Run a call through a hosted testing agent: place the call, poll the platform
 * until it ends, then judge the returned transcript with the same Judge +
 * metrics pipeline as every other run. The hosted agent runs the conversation
 * itself (scripted via its system prompt), so there is no live turn-by-turn
 * control here — evaluation happens on the completed transcript.
 */
export async function runHostedCall(opts: HostedRunOptions): Promise<TestResult> {
  const runId = id("run");
  const startedAt = now();
  let externalCallId: string | undefined;

  try {
    const placed = await opts.integration.placeCall(opts.account, opts.agent, opts.target);
    externalCallId = placed.externalCallId;

    const interval = opts.pollIntervalMs ?? 3000;
    const deadline = startedAt + (opts.timeoutMs ?? 300_000);
    let transcript: Transcript = [];
    let status: HostedCallStatus = "queued";

    while (now() < deadline) {
      const state = await opts.integration.getCall(opts.account, externalCallId);
      status = state.status;
      if (state.transcript) transcript = state.transcript;
      if (status === "ended" || status === "failed") break;
      await sleep(interval);
    }

    if (status === "failed") {
      return errored(runId, opts.testCaseId, startedAt, transcript, externalCallId, "hosted call failed");
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
    return errored(runId, opts.testCaseId, startedAt, [], externalCallId, (err as Error).message);
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
