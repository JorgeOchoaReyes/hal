import { NextRequest, NextResponse } from "next/server";
import { Judge, createLLM, type JudgeSpec } from "@hal/core";
import { getProdCall, getJudge, getTarget, mergeJudgesById, upsertProdCall } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Score a production call. The judges applied are, in order of precedence:
 *   1. an explicit `judgeIds` list (or single `judgeId`) in the request body,
 *   2. otherwise the judges attached to the call's assigned agent (My agents),
 *   3. otherwise the call's last-used judge.
 * Multiple judges are merged into one spec and evaluated in a single pass.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const call = getProdCall(id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { judgeId?: string; judgeIds?: string[] };

  // Resolve which judges to apply.
  let judgeIds = body.judgeIds ?? (body.judgeId ? [body.judgeId] : undefined);
  let source: "request" | "agent" | "call" = "request";
  if (!judgeIds || judgeIds.length === 0) {
    const agent = call.targetAgentId ? getTarget(call.targetAgentId) : undefined;
    if (agent?.judgeIds?.length) {
      judgeIds = agent.judgeIds;
      source = "agent";
    } else if (call.judgeId) {
      judgeIds = [call.judgeId];
      source = "call";
    }
  }
  if (!judgeIds || judgeIds.length === 0) {
    return NextResponse.json(
      { error: "No judge to apply — pick a judge, or attach judges to the call's assigned agent." },
      { status: 400 },
    );
  }

  // Build the spec: a single judge keeps its own provider/model; several are merged.
  let spec: JudgeSpec | undefined;
  if (judgeIds.length === 1) spec = getJudge(judgeIds[0]!)?.spec;
  else spec = mergeJudgesById(judgeIds);
  if (!spec) return NextResponse.json({ error: "Unknown judge(s)" }, { status: 400 });

  const lastJudgeId = judgeIds.length === 1 ? judgeIds[0] : call.judgeId;
  try {
    // The judge's provider ("auto" by default) picks OpenAI/Anthropic/Gemini
    // when a key is set, else a deterministic mock; code-rule checks work
    // regardless of LLM availability.
    const evaluator = new Judge(createLLM(spec.provider ?? "auto", spec.model));
    const verdict = await evaluator.evaluate(spec, call.transcript);
    const next = {
      ...call,
      judgeId: lastJudgeId,
      judgeIds,
      verdict,
      status: "scored" as const,
      error: undefined,
    };
    upsertProdCall(next);
    return NextResponse.json({ prodCall: next, appliedFrom: source });
  } catch (e) {
    const next = { ...call, judgeId: lastJudgeId, status: "error" as const, error: (e as Error).message };
    upsertProdCall(next);
    return NextResponse.json({ error: (e as Error).message, prodCall: next }, { status: 500 });
  }
}
