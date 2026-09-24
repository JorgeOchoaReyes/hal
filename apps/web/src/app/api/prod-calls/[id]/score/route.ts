import { NextRequest, NextResponse } from "next/server";
import { Judge, createLLM } from "@hal/core";
import { getProdCall, getJudge, upsertProdCall } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Apply a saved judge to a production call's transcript and store the verdict. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const call = getProdCall(id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { judgeId?: string };
  const judgeId = body.judgeId ?? call.judgeId;
  const judge = judgeId ? getJudge(judgeId) : undefined;
  if (!judge) return NextResponse.json({ error: "Unknown or missing judge" }, { status: 400 });

  try {
    // The judge's provider ("auto" by default) picks OpenAI/Anthropic/Gemini
    // when a key is set, else a deterministic mock; code-rule checks work
    // regardless of LLM availability.
    const evaluator = new Judge(createLLM(judge.spec.provider ?? "auto", judge.spec.model));
    const verdict = await evaluator.evaluate(judge.spec, call.transcript);
    const next = { ...call, judgeId: judge.id, verdict, status: "scored" as const, error: undefined };
    upsertProdCall(next);
    return NextResponse.json({ prodCall: next });
  } catch (e) {
    const next = { ...call, judgeId: judge.id, status: "error" as const, error: (e as Error).message };
    upsertProdCall(next);
    return NextResponse.json({ error: (e as Error).message, prodCall: next }, { status: 500 });
  }
}
