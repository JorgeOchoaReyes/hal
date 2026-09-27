import { NextResponse } from "next/server";
import { computeMetrics, deriveLabels, getIntegration, type TestResult, type ProviderAccount } from "@hal/core";
import { getAccountRaw, getResult, listAccounts, saveResult } from "@/lib/store";
import { downloadRunRecording } from "@/lib/runRecordings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const active = new Set<string>();

/** Refresh provider data for a saved run without changing its original evaluation. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getResult(id);
  if (!run?.externalCallId) return NextResponse.json({ error: "This run has no provider call ID." }, { status: 400 });
  if (active.has(id)) return NextResponse.json({ error: "This run is already syncing." }, { status: 409 });
  const dispatchedSide: "testingAgent" | "targetAgent" = run.context?.targetAgent.direction === "outbound" ? "targetAgent" : "testingAgent";
  const otherSide: "testingAgent" | "targetAgent" = dispatchedSide === "testingAgent" ? "targetAgent" : "testingAgent";
  const source = run.context?.account ?? run.recordingSource ?? run.providerCalls?.[dispatchedSide];
  const account = source ? getAccountRaw("accountId" in source ? source.accountId : source.id) : undefined;
  if (!account || account.provider !== source?.provider) return NextResponse.json({ error: "The original provider account is unavailable." }, { status: 400 });
  const integration = getIntegration(account.provider);
  if (!integration) return NextResponse.json({ error: "Provider integration unavailable." }, { status: 400 });
  active.add(id);
  try {
    const primary = await integration.getCall(account, run.externalCallId);
    let updated: TestResult = { ...getResult(id)!,
      providerCalls: primary.details ? { ...run.providerCalls, [dispatchedSide]: {
        provider: account.provider, accountId: account.id, externalCallId: run.externalCallId,
        fetchedAt: Date.now(), details: primary.details, events: primary.events,
      } } : run.providerCalls,
      trace: [...(run.trace ?? []).filter((event) => event.side !== dispatchedSide),
        ...(primary.trace ?? []).map((event) => ({ ...event, side: dispatchedSide }))],
    };
    if (primary.transcript?.length) {
      updated.transcript = primary.transcript.map((turn) => ({ ...turn, metadataSource: dispatchedSide,
        role: dispatchedSide === "targetAgent" ? turn.role === "agent" ? "target" as const : turn.role === "target" ? "agent" as const : turn.role : turn.role }));
      if (updated.metrics) {
        updated.metrics = computeMetrics(updated);
        updated.labels = deriveLabels(updated.metrics);
      }
    }
    const receiver = run.context?.[otherSide];
    const known = run.providerCalls?.[otherSide];
    const receiverIntegration = getIntegration(known?.provider ?? receiver?.provider ?? account.provider);
    let receiverAccount: ProviderAccount | undefined = known ? getAccountRaw(known.accountId) : undefined;
    let receiverCallId = known?.externalCallId;
    let receiverWarning: string | undefined;
    if (!receiverCallId && receiverIntegration?.findInboundCall && receiver?.phoneNumber) {
      const accounts = listAccounts().filter((candidate) => candidate.provider === receiverIntegration.id)
        .map((candidate) => getAccountRaw(candidate.id)).filter((candidate): candidate is ProviderAccount => candidate !== undefined);
      const found = await Promise.allSettled(accounts.map(async (candidate) => ({ account: candidate,
        callId: await receiverIntegration.findInboundCall!(candidate, {
          toNumber: receiver.phoneNumber!, fromNumber: run.context?.[dispatchedSide].phoneNumber,
          externalAgentId: receiver.externalAgentId, startedAt: run.startedAt, excludeCallId: run.externalCallId!,
        }),
      })));
      const matches = found.flatMap((item) => item.status === "fulfilled" && item.value.callId ? [item.value] : []);
      if (matches.length === 1) { receiverAccount = matches[0].account; receiverCallId = matches[0].callId; }
      else if (matches.length > 1) receiverWarning = "Several receiving calls matched. Attach the correct call ID to fetch its details.";
    }
    if (receiverAccount && receiverCallId && receiverIntegration) {
      try {
        const receivingCall = await receiverIntegration.getCall(receiverAccount, receiverCallId);
        if (receivingCall.details) updated.providerCalls = { ...updated.providerCalls, [otherSide]: {
          provider: receiverAccount.provider, accountId: receiverAccount.id, externalCallId: receiverCallId,
          fetchedAt: Date.now(), details: receivingCall.details, events: receivingCall.events,
        } };
        updated.trace = [...(updated.trace ?? []).filter((event) => event.side !== otherSide),
          ...(receivingCall.trace ?? []).map((event) => ({ ...event, side: otherSide }))];
      } catch (error) { receiverWarning = `Receiving call could not be refreshed: ${(error as Error).message}`; }
    }
    saveResult(updated);
    const previousAudio = updated.recording?.downloadedAt;
    if (primary.status === "ended" && integration.getRecording) await downloadRunRecording(id, true);
    const latest = getResult(id)!;
    const recordingWarning = primary.status === "ended" && integration.getRecording
      && latest.recording?.downloadedAt === previousAudio
      ? "The provider has no newer recording yet. Any previously saved audio was kept." : undefined;
    return NextResponse.json({ state: primary.status, recording: latest.recording, receiverWarning, recordingWarning, result: latest });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  } finally { active.delete(id); }
}
