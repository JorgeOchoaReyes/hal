import { NextRequest, NextResponse } from "next/server";
import { getIntegration } from "@hal/core";
import { getAccountRaw } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fetch a call's transcript straight from the provider by its call id, so a
 * production call can be imported into a simulation without first bringing
 * it into HAL as a Production call.
 */
export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId");
  const callId = req.nextUrl.searchParams.get("callId");
  if (!accountId || !callId) {
    return NextResponse.json({ error: "accountId and callId required" }, { status: 400 });
  }

  const account = getAccountRaw(accountId);
  if (!account) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  const integration = getIntegration(account.provider);
  if (!integration) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  try {
    const call = await integration.getCall(account, callId);
    if (!call.transcript) {
      return NextResponse.json(
        { error: `Call ${callId} has no transcript yet (status: ${call.status}).` },
        { status: 409 },
      );
    }
    return NextResponse.json({ transcript: call.transcript, status: call.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
