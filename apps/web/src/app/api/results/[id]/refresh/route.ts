import { NextResponse } from "next/server";
import { createLLM, getIntegration, refreshHostedCall } from "@hal/core";
import { getAccountRaw, getResult, saveResult } from "@/lib/store";
import { downloadRunRecording } from "@/lib/runRecordings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

declare global {
  var __halRefreshingRuns: Set<string> | undefined;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getResult(id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  const retryJudgeError = run.status === "failed" && run.verdict?.summary.startsWith("Judge LLM error:");
  if ((run.status !== "errored" && !retryJudgeError) || !run.externalCallId || !run.context?.account || !run.context.judge) {
    return NextResponse.json({ error: "This run cannot be checked again." }, { status: 400 });
  }
  const account = getAccountRaw(run.context.account.id);
  if (!account || account.provider !== run.context.account.provider) {
    return NextResponse.json({ error: "The original provider account is unavailable." }, { status: 400 });
  }
  const integration = getIntegration(account.provider);
  if (!integration) return NextResponse.json({ error: "Provider integration unavailable." }, { status: 400 });
  const refreshing = globalThis.__halRefreshingRuns ??= new Set<string>();
  if (refreshing.has(id)) return NextResponse.json({ error: "This run is already being checked." }, { status: 409 });
  refreshing.add(id);
  try {
    const checked = await refreshHostedCall({
      result: run, integration, account, judge: run.context.judge,
      llm: createLLM(run.context.judge.provider ?? "auto", run.context.judge.model),
      providerAgentRole: run.context.targetAgent.direction === "outbound" ? "target" : "agent",
    });
    if (checked.result) {
      const latest = getResult(id)!;
      saveResult({ ...latest, ...checked.result, evaluations: latest.evaluations, recording: latest.recording });
      if (checked.state === "completed" && integration.getRecording && latest.recording?.status !== "available") {
        await downloadRunRecording(id);
      }
    }
    return NextResponse.json({ state: checked.state, result: getResult(id) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  } finally {
    refreshing.delete(id);
  }
}
