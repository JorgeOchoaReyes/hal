import { NextRequest, NextResponse } from "next/server";
import { getIntegration } from "@hal/core";
import { getAccountRaw } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * List the phone numbers owned on a provider account, so the UI can offer a
 * picker instead of manual entry. Returns `{ supported: false }` when the
 * provider can't enumerate numbers, so the client falls back to a text field.
 */
export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId) return NextResponse.json({ error: "accountId required" }, { status: 400 });

  const account = getAccountRaw(accountId);
  if (!account) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  const integration = getIntegration(account.provider);
  if (!integration) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  if (!integration.listNumbers) {
    return NextResponse.json({ supported: false, numbers: [] });
  }

  try {
    const numbers = await integration.listNumbers(account);
    return NextResponse.json({ supported: true, numbers });
  } catch (err) {
    // Reachability/parse failure — still let the user type a number by hand.
    return NextResponse.json({ supported: true, numbers: [], error: (err as Error).message });
  }
}
