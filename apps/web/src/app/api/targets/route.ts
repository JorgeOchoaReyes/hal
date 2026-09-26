import { NextRequest, NextResponse } from "next/server";
import { id, type Target, type TargetAgent, type CallDirection } from "@hal/core";
import { publicAgent, getAccountRaw, resolveByotKey, listTargets, upsertTarget } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** List the real target agents under test ("My agents"). */
export async function GET() {
  return NextResponse.json({ targets: listTargets() });
}

/** Register a new target agent. */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    name?: string;
    target?: Target;
    description?: string;
    provider?: string;
    direction?: CallDirection;
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
  if (!body.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!body.target?.transport)
    return NextResponse.json({ error: "target with a transport required" }, { status: 400 });
  if (body.direction && body.direction !== "inbound" && body.direction !== "outbound")
    return NextResponse.json({ error: "direction must be 'inbound' or 'outbound'" }, { status: 400 });

  if (body.byotKeyId && (getAccountRaw(body.byotAccountId ?? "")?.provider !== "bland" || !resolveByotKey(body.byotAccountId ?? "", body.byotKeyId))) return NextResponse.json({ error: "Select a saved key from its Bland account" }, { status: 400 });
  const agent: TargetAgent = {
    id: id("target"),
    byotKeyId: body.byotKeyId || undefined,
    byotAccountId: body.byotAccountId || undefined,
    name: body.name.trim(),
    target: body.target,
    description: body.description?.trim() || undefined,
    provider: body.provider?.trim() || undefined,
    direction: body.direction ?? "inbound",
    encryptedKey: body.encryptedKey?.trim() || undefined,
    externalAgentId: body.externalAgentId?.trim() || undefined,
    createdAt: Date.now(),
  };
  upsertTarget(agent);
  return NextResponse.json({ target: publicAgent(agent) }, { status: 201 });
}
