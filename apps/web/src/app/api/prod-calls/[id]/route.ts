import { NextRequest, NextResponse } from "next/server";
import { getProdCall, upsertProdCall, deleteProdCall } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Assign a real agent and/or remember a judge on a production call. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const call = getProdCall(id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    targetAgentId?: string | null;
    judgeId?: string | null;
    name?: string;
  };
  const next = {
    ...call,
    name: body.name?.trim() || call.name,
    targetAgentId:
      body.targetAgentId === null ? undefined : body.targetAgentId ?? call.targetAgentId,
    judgeId: body.judgeId === null ? undefined : body.judgeId ?? call.judgeId,
  };
  upsertProdCall(next);
  return NextResponse.json({ prodCall: next });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = deleteProdCall(id);
  return NextResponse.json({ deleted: ok }, { status: ok ? 200 : 404 });
}
