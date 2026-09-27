import "server-only";
import { stat } from "node:fs/promises";
import { getIntegration } from "@hal/core";
import { getAccountRaw, getResult, saveResult } from "./store";
import { persistRecording, recordingPath } from "./recordingFiles";

const active = new Map<string, Promise<void>>();

export async function downloadRunRecording(runId: string, force = false): Promise<void> {
  if (active.has(runId)) return active.get(runId)!;
  const task = download(runId, force).finally(() => active.delete(runId));
  active.set(runId, task);
  return task;
}

async function download(runId: string, force: boolean) {
  const run = getResult(runId);
  if (!run) throw new Error("Run not found");
  if (!force && run.recording?.status === "available" && await stat(recordingPath(runId)).catch(() => null)) return;
  const side = run.context?.targetAgent.direction === "outbound" ? "targetAgent" : "testingAgent";
  const source = run.recordingSource ?? (run.context?.account ? {
    provider: run.context.account.provider, accountId: run.context.account.id,
  } : run.providerCalls?.[side] ? {
    provider: run.providerCalls[side]!.provider, accountId: run.providerCalls[side]!.accountId,
  } : undefined);
  const account = source ? getAccountRaw(source.accountId) : undefined;
  const integration = source ? getIntegration(source.provider) : undefined;
  try {
    if (!run.externalCallId || !account || account.provider !== source?.provider || !integration?.getRecording) {
      throw new Error("The original provider account is required to download this recording.");
    }
    const recording = await persistRecording(runId, await integration.getRecording(account, run.externalCallId));
    saveResult({ ...getResult(runId)!, recording });
  } catch (err) {
    const error = err instanceof Error && /Bland|Retell|Vapi|ElevenLabs|Recording|recording|provider account/.test(err.message)
      ? err.message : "Recording download failed. Check your connection and retry.";
    const latest = getResult(runId)!;
    saveResult({ ...latest, recording: latest.recording?.status === "available"
      && await stat(recordingPath(runId)).catch(() => null) ? latest.recording : { status: "unavailable", error } });
  }
}
