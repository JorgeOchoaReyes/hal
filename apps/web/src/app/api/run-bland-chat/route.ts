import { NextRequest, NextResponse } from "next/server";
import { BlandChatTransport, TestRunner, createLLM } from "@hal/core";
import { getAccountRaw, getTestCase, getTarget, saveResult } from "@/lib/store";
import { snapshotRun } from "@/lib/runContext";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.testCaseId !== "string" || typeof body.accountId !== "string" || typeof body.pathwayId !== "string" || !body.pathwayId.trim()) return NextResponse.json({ error: "Select a simulation, Bland account and target pathway" }, { status: 400 });
  const account = getAccountRaw(body.accountId);
  const source = getTestCase(body.testCaseId);
  if (!source) return NextResponse.json({ error: "Unknown simulation" }, { status: 404 });
  if (account?.provider !== "bland") return NextResponse.json({ error: "Select a Bland account" }, { status: 400 });
  const target = typeof body.targetAgentId === "string" ? getTarget(body.targetAgentId) : undefined;
  if (body.targetAgentId && (!target || target.provider !== "bland" || target.externalAgentId !== body.pathwayId.trim())) return NextResponse.json({ error: "The target and pathway do not match. Select the target again." }, { status: 400 });
  const tc = structuredClone(source);
  tc.target = { transport: "bland-chat", name: target?.name ?? "Bland pathway", pathwayId: body.pathwayId.trim() };
  tc.scenario.maxTurns = Math.min(tc.scenario.maxTurns ?? 40, 100);
  tc.scenario.maxDurationMs = Math.min(tc.scenario.maxDurationMs ?? 180000, 180000);
  const llm = createLLM("auto");
  const judgeLlm = createLLM(tc.judge.provider ?? "auto", tc.judge.model);
  if ((llm.name === "mock" && (tc.scenario.structured || JSON.stringify(tc.scenario.steps).includes('"prompt"'))) || (judgeLlm.name === "mock" && tc.judge.mode !== "rules-only" && (tc.judge.criteria?.length || tc.judge.metrics?.length))) return NextResponse.json({ error: "Configure an LLM provider in Settings for dynamic scenario steps or AI judges. Scripted steps and rule-only judges work without one." }, { status: 400 });
  const context = snapshotRun(tc);
  context.transport = "bland-chat";
  context.account = { id: account.id, label: account.label, provider: "bland" };
  context.testingAgent = { name: tc.scenario.persona.name, provider: "hal", persona: tc.scenario.persona, configuration: { steps: tc.scenario.steps, structured: tc.scenario.structured } };
  context.targetAgent = { id: target?.id, name: tc.target.name, provider: "bland", pathwayId: tc.target.pathwayId, pathwaySource: "dispatch", executionMode: "pathway" };
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(180000)]);
  const transport = new BlandChatTransport(account.credentials.apiKey ?? "", fetch, signal);
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
