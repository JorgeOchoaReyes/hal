import { NextRequest, NextResponse } from "next/server";
import { getIntegration } from "@hal/core";
import { getAccountRaw } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Pre-flight: verify a stored account's credentials against the provider API. */
export async function POST(req: NextRequest) {
  const { accountId } = (await req.json()) as { accountId: string };
  const account = getAccountRaw(accountId);
  if (!account) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  const integration = getIntegration(account.provider);
  if (!integration) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  const check = await integration.verifyCredentials(account);
  return NextResponse.json(check);
}
