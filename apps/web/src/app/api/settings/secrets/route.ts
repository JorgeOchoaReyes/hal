import { NextRequest, NextResponse } from "next/server";
import { getSecretsStatus, setSecrets, SECRET_KEYS, type SecretKey } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ secrets: getSecretsStatus() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { values?: Record<string, string | null> };
  const patch: Partial<Record<SecretKey, string | null>> = {};
  for (const key of SECRET_KEYS) {
    if (body.values && key in body.values) patch[key] = body.values[key];
  }
  return NextResponse.json({ secrets: setSecrets(patch) });
}
