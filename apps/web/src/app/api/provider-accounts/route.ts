import { NextRequest, NextResponse } from "next/server";
import { getIntegration, id, type ProviderAccount } from "@hal/core";
import { getAccountRaw, listAccounts, upsertAccount } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const accounts = listAccounts();
  const reveal = req.nextUrl.searchParams.get("reveal") === "1";
  return NextResponse.json({ accounts: reveal ? accounts.map((account) => getAccountRaw(account.id) ?? account) : accounts }, { headers: { "Cache-Control": "no-store" } });
}

/** Connect a provider account by storing its credentials. */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    provider: string;
    label: string;
    credentials: Record<string, string>;
  };
  const integration = getIntegration(body.provider);
  if (!integration) {
    return NextResponse.json({ error: `Unknown provider "${body.provider}"` }, { status: 400 });
  }
  const missing = integration.credentialFields
    .filter((f) => f.required && !body.credentials?.[f.key]?.trim())
    .map((f) => f.label);
  if (missing.length > 0) {
    return NextResponse.json({ error: `Missing: ${missing.join(", ")}` }, { status: 400 });
  }

  const account: ProviderAccount = {
    id: id("acct"),
    provider: body.provider,
    label: body.label || integration.label,
    credentials: body.credentials,
    createdAt: Date.now(),
  };
  upsertAccount(account);
  // Never echo credentials back.
  return NextResponse.json(
    { account: { ...account, credentials: undefined } },
    { status: 201 },
  );
}
