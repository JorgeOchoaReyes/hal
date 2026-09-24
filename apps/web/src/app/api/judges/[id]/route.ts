import { NextRequest, NextResponse } from "next/server";
import type { SavedJudge, JudgeSpec } from "@hal/core";
import { getJudge, upsertJudge, deleteJudge } from "@/lib/store";
import { judgeKind } from "../route";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = getJudge(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    spec?: JudgeSpec;
  };
  const spec: JudgeSpec = {
    mode: body.spec?.mode ?? existing.spec.mode ?? "all",
    provider: body.spec?.provider ?? existing.spec.provider ?? "auto",
    model: body.spec?.model ?? existing.spec.model,
    rules: body.spec?.rules ?? existing.spec.rules ?? [],
    criteria: (body.spec?.criteria ?? existing.spec.criteria ?? []).filter((c) => c.trim()),
    metrics: (body.spec?.metrics ?? existing.spec.metrics ?? []).filter((m) => m.name?.trim()),
  };
  const judge: SavedJudge = {
    ...existing,
    name: body.name?.trim() || existing.name,
    description: body.description?.trim() || undefined,
    kind: judgeKind(spec),
    spec,
  };
  upsertJudge(judge);
  return NextResponse.json({ judge });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = deleteJudge(id);
  return NextResponse.json({ deleted: ok }, { status: ok ? 200 : 404 });
}
