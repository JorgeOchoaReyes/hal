import { NextRequest, NextResponse } from "next/server";
import type { Target } from "@hal/core";
import { publicAgent, getAccountRaw, resolveByotKey, getTarget, upsertTarget, deleteTarget } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Update a target agent (name / provider / direction / address / description / judges). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = getTarget(id);
  if (!existing) return NextResponse.json({ error: "Unknown target" }, { status: 404 });

  const body = (await req.json()) as {
    name?: string;
    target?: Target;
    description?: string;
    provider?: string;
    direction?: "inbound" | "outbound";
    judgeIds?: string[];
    /**
     * Per-agent provider secret used to dispatch an outbound call from this
     * agent (e.g. Bland's encrypted key). Stored as given, not re-encrypted.
     */
    encryptedKey?: string;
    byotKeyId?: string;
    byotAccountId?: string;
    /** The provider's pathway/agent id for this agent (e.g. a Bland Pathway id). */
    externalAgentId?: string;
  };
  if (body.byotKeyId && (getAccountRaw(body.byotAccountId ?? "")?.provider !== "bland" || !resolveByotKey(body.byotAccountId ?? "", body.byotKeyId))) return NextResponse.json({ error: "Select a saved key from its Bland account" }, { status: 400 });
  const updated = {
    ...existing,
    byotKeyId: body.byotKeyId !== undefined ? body.byotKeyId || undefined : existing.byotKeyId,
    byotAccountId: body.byotAccountId !== undefined ? body.byotAccountId || undefined : existing.byotAccountId,
    name: body.name?.trim() || existing.name,
    target: body.target ?? existing.target,
    description: body.description?.trim() || existing.description,
    provider: body.provider ?? existing.provider,
    direction: body.direction ?? existing.direction,
    judgeIds: body.judgeIds ?? existing.judgeIds,
    encryptedKey: body.encryptedKey !== undefined ? body.encryptedKey.trim() || undefined : existing.encryptedKey,
    externalAgentId:
      body.externalAgentId !== undefined ? body.externalAgentId.trim() || undefined : existing.externalAgentId,
  };
  upsertTarget(updated);
  return NextResponse.json({ target: publicAgent(updated) });
}

/** Remove a target agent. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ ok: deleteTarget(id) });
}
