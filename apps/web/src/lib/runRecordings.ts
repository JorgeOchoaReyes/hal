import "server-only";
import { stat } from "node:fs/promises";
import { getIntegration } from "@hal/core";
import { getAccountRaw, getResult, saveResult } from "./store";
import { persistRecording, recordingPath } from "./recordingFiles";

const active = new Map<string, Promise<void>>();

export async function downloadRunRecording(runId: string): Promise<void> {
  if (active.has(runId)) return active.get(runId)!;
  const task = download(runId).finally(() => active.delete(runId));
  active.set(runId, task);
  return task;
}

async function download(runId: string) {
  const run = getResult(runId);
  if (!run) throw new Error("Run not found");
  if (run.recording?.status === "available" && await stat(recordingPath(runId)).catch(() => null)) return;
  const source = run.recordingSource;
  const account = source ? getAccountRaw(source.accountId) : undefined;
  const integration = source ? getIntegration(source.provider) : undefined;
  try {
    if (!run.externalCallId || !account || account.provider !== source?.provider || !integration?.getRecording) {
      throw new Error("The original provider account is required to download this recording.");
    }
    const recording = await persistRecording(runId, await integration.getRecording(account, run.externalCallId));
    saveResult({ ...getResult(runId)!, recording });
  } catch (err) {
    const error = err instanceof Error && /Bland|Recording|recording|provider account/.test(err.message)
      ? err.message : "Recording download failed. Check your connection and retry.";
    saveResult({ ...getResult(runId)!, recording: { status: "unavailable", error } });
  }
}
