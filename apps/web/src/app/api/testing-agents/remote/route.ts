import { NextRequest, NextResponse } from "next/server";
import { getIntegration } from "@hal/core";
import { getAccountRaw } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * List agents/pathways that already exist on a provider account, so the UI can
 * offer them for import instead of creating a new testing agent. Returns
 * `{ supported: false }` when the provider can't enumerate them, so the client
 * falls back to a manual id field.
 */
export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId) return NextResponse.json({ error: "accountId required" }, { status: 400 });

  const account = getAccountRaw(accountId);
  if (!account) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  const integration = getIntegration(account.provider);
  if (!integration) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  if (!integration.listRemoteAgents) {
    return NextResponse.json({ supported: false, agents: [] });
  }

  try {
    const agents = await integration.listRemoteAgents(account);
    return NextResponse.json({ supported: true, agents });
  } catch (err) {
    // Reachability/parse failure — still let the user paste an id by hand.
    return NextResponse.json({ supported: true, agents: [], error: (err as Error).message });
  }
}
