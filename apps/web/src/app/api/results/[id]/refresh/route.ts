import { NextResponse } from "next/server";
import { createLLM, getIntegration, refreshHostedCall } from "@hal/core";
import { getAccountRaw, getResult, listAccounts, saveResult } from "@/lib/store";
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
  if ((run.status !== "running" && run.status !== "errored" && !retryJudgeError) || !run.externalCallId || !run.context?.account || !run.context.judge) {
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
      const updated = { ...latest, ...checked.result, evaluations: latest.evaluations, recording: latest.recording };
      const otherSide: "testingAgent" | "targetAgent" = run.context.targetAgent.direction === "outbound" ? "testingAgent" : "targetAgent";
      const receiver = run.context[otherSide];
      const receiverIntegration = getIntegration(receiver.provider ?? account.provider);
      if (receiverIntegration?.findInboundCall && receiver.phoneNumber && !updated.providerCalls?.[otherSide]) {
        try {
          const receiverAccounts = listAccounts().filter((candidate) => candidate.provider === receiverIntegration.id)
            .map((candidate) => getAccountRaw(candidate.id)).filter((candidate) => candidate !== undefined);
          const candidates = await Promise.allSettled(receiverAccounts.map(async (candidate) => ({
            account: candidate, callId: await receiverIntegration.findInboundCall!(candidate, {
              toNumber: receiver.phoneNumber!,
              fromNumber: run.context![otherSide === "testingAgent" ? "targetAgent" : "testingAgent"].phoneNumber,
              externalAgentId: receiver.externalAgentId,
              startedAt: run.startedAt, excludeCallId: run.externalCallId!,
            }),
          })));
          const matches = candidates.flatMap((candidate) => candidate.status === "fulfilled" && candidate.value.callId ? [candidate.value] : []);
          if (matches.length === 1) {
            const { account: receiverAccount, callId: inboundId } = matches[0];
            const inbound = await receiverIntegration.getCall(receiverAccount, inboundId!);
            if (inbound.details) {
              updated.providerCalls = { ...updated.providerCalls, [otherSide]: {
                provider: receiverAccount.provider, accountId: receiverAccount.id, externalCallId: inboundId!,
                fetchedAt: Date.now(), details: inbound.details, events: inbound.events,
              } };
              updated.trace = [...(updated.trace ?? []), ...(inbound.trace ?? []).map((event) => ({ ...event, side: otherSide as "testingAgent" | "targetAgent" }))];
            }
          }
        } catch { /* A second provider record is optional; keep the primary result. */ }
      }
      saveResult(updated);
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
