import { NextRequest, NextResponse } from "next/server";
import { Judge, createLLM, id as newId, type RunEvaluation } from "@hal/core";
import { getResult, getJudge, saveResult } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getResult(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (!run.transcript.length) return NextResponse.json({ error: "This run has no transcript to evaluate." }, { status: 400 });
  const body = await req.json().catch(() => null);
  if (!Array.isArray(body?.judgeIds) || !body.judgeIds.length || body.judgeIds.length > 10 || body.judgeIds.some((j: unknown) => typeof j !== "string")) {
    return NextResponse.json({ error: "Select between 1 and 10 saved judges." }, { status: 400 });
  }
  const ids = [...new Set<string>(body.judgeIds)];
  const judges = ids.map(getJudge);
  if (judges.some((j) => !j)) return NextResponse.json({ error: "A selected judge no longer exists. Refresh and select again." }, { status: 400 });
  // Snapshot before awaiting; edits during evaluation must not rewrite history.
  const snapshots = structuredClone(judges.filter((j) => j !== undefined));
  const evaluations: RunEvaluation[] = [];
  for (const judge of snapshots) {
    const entry: RunEvaluation = { id: newId("evaluation"), createdAt: Date.now(), judge, provider: "", model: "" };
    try {
      const llm = createLLM(judge.spec.provider ?? "auto", judge.spec.model);
      entry.provider = llm.name;
      entry.model = judge.spec.model ?? llm.defaultModel;
      if (judge.spec.mode !== "rules-only" && (judge.spec.criteria?.length || judge.spec.metrics?.length) && llm.name === "mock") {
        throw new Error("Configure an LLM provider in Settings before applying an AI judge.");
      }
      entry.verdict = await new Judge(llm).evaluate(judge.spec, run.transcript);
    } catch (err) { entry.error = (err as Error).message; }
    evaluations.push(entry);
  }
  // Read the current record again: concurrent evaluations/downloads may have finished.
  const latest = getResult(id)!;
  saveResult({ ...latest, evaluations: [...(latest.evaluations ?? []), ...evaluations] });
  return NextResponse.json({ evaluations });
}
