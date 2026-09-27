import { NextRequest, NextResponse } from "next/server";
import { BlandChatTransport, HostedChatTransport, TestRunner, createLLM } from "@hal/core";
import { getAccountRaw, getTestCase, getTarget, saveResult } from "@/lib/store";
import { snapshotRun } from "@/lib/runContext";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { testCaseId?: string; accountId?: string; agentId?: string; targetAgentId?: string; resourceKind?: "assistant" | "squad" } | null;
  if (!body?.testCaseId || !body.accountId || !body.agentId?.trim()) return NextResponse.json({ error: "Select a simulation, provider account and target agent" }, { status: 400 });
  const account = getAccountRaw(body.accountId);
  const source = getTestCase(body.testCaseId);
  if (!source) return NextResponse.json({ error: "Unknown simulation" }, { status: 404 });
  if (!account || !["bland", "vapi", "retell", "elevenlabs"].includes(account.provider)) return NextResponse.json({ error: "Select a supported provider account" }, { status: 400 });
  const target = body.targetAgentId ? getTarget(body.targetAgentId) : undefined;
  if (body.targetAgentId && (!target || target.provider !== account.provider || target.externalAgentId !== body.agentId.trim())) return NextResponse.json({ error: "The selected target and provider agent do not match" }, { status: 400 });
  const tc = structuredClone(source);
  const agentId = body.agentId.trim();
  const provider = account.provider as "bland" | "vapi" | "retell" | "elevenlabs";
  tc.target = provider === "bland"
    ? { transport: "bland-chat", name: target?.name ?? "Bland pathway", pathwayId: agentId }
    : { transport: "hosted-chat", name: target?.name ?? `${provider} agent`, provider, externalAgentId: agentId, ...(provider === "vapi" ? { resourceKind: body.resourceKind === "squad" ? "squad" as const : "assistant" as const } : {}) };
  tc.scenario.maxTurns = Math.min(tc.scenario.maxTurns ?? 40, 100);
  tc.scenario.maxDurationMs = Math.min(tc.scenario.maxDurationMs ?? 180000, 180000);
  const llm = createLLM("auto");
  const judgeLlm = createLLM(tc.judge.provider ?? "auto", tc.judge.model);
  if ((llm.name === "mock" && (tc.scenario.structured || JSON.stringify(tc.scenario.steps).includes('"prompt"'))) || (judgeLlm.name === "mock" && tc.judge.mode !== "rules-only" && (tc.judge.criteria?.length || tc.judge.metrics?.length))) return NextResponse.json({ error: "Configure an LLM provider in Settings for dynamic scenario steps or AI judges. Scripted steps and rule-only judges work without one." }, { status: 400 });
  const context = snapshotRun(tc);
  context.transport = tc.target.transport;
  context.account = { id: account.id, label: account.label, provider };
  context.testingAgent = { name: tc.scenario.persona.name, provider: "hal", persona: tc.scenario.persona, configuration: { steps: tc.scenario.steps, structured: tc.scenario.structured } };
  context.targetAgent = { id: target?.id, name: tc.target.name, provider, externalAgentId: agentId, ...(provider === "bland" ? { pathwayId: agentId, pathwaySource: "dispatch" as const, executionMode: "pathway" as const } : {}) };
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(180000)]);
  const transport = provider === "bland"
    ? new BlandChatTransport(account.credentials.apiKey ?? "", fetch, signal)
    : new HostedChatTransport(account.credentials.apiKey ?? "", fetch, signal);
  const handle = new TestRunner({ llm, judgeLlm, resolveTransport: () => transport }).run(tc);
  const abort = () => handle.abort();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const result = await handle.result;
    result.context = context;
    saveResult(result);
    return NextResponse.json({ result });
  } finally { signal.removeEventListener("abort", abort); }
}
