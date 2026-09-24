import { NextRequest, NextResponse } from "next/server";
import { id, type SavedJudge, type JudgeSpec } from "@hal/core";
import { listJudges, upsertJudge } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Derive the UI "kind" hint from what the spec actually uses. */
export function judgeKind(spec: JudgeSpec): SavedJudge["kind"] {
  const hasCode = (spec.rules?.length ?? 0) > 0;
  const hasLlm = (spec.criteria?.length ?? 0) > 0 || (spec.metrics?.length ?? 0) > 0;
  if (hasCode && hasLlm) return "hybrid";
  if (hasCode) return "code";
  return "llm";
}

export async function GET() {
  return NextResponse.json({ judges: listJudges() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    spec?: JudgeSpec;
  };
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const spec: JudgeSpec = {
    mode: body.spec?.mode ?? "all",
    provider: body.spec?.provider ?? "auto",
    model: body.spec?.model,
    rules: body.spec?.rules ?? [],
    criteria: (body.spec?.criteria ?? []).filter((c) => c.trim()),
    metrics: (body.spec?.metrics ?? []).filter((m) => m.name?.trim()),
  };
  const judge: SavedJudge = {
    id: id("judge"),
    name: body.name.trim(),
    description: body.description?.trim() || undefined,
    kind: judgeKind(spec),
    spec,
    createdAt: Date.now(),
  };
  upsertJudge(judge);
  return NextResponse.json({ judge }, { status: 201 });
}
