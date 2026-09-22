import { NextRequest, NextResponse } from "next/server";
import type { Target } from "@hal/core";
import { getTarget, upsertTarget, deleteTarget } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Update a target agent (name / address / description). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = getTarget(id);
  if (!existing) return NextResponse.json({ error: "Unknown target" }, { status: 404 });

  const body = (await req.json()) as { name?: string; target?: Target; description?: string };
  const updated = {
    ...existing,
    name: body.name?.trim() || existing.name,
    target: body.target ?? existing.target,
    description: body.description?.trim() || existing.description,
  };
  upsertTarget(updated);
  return NextResponse.json({ target: updated });
}

/** Remove a target agent. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ ok: deleteTarget(id) });
}
