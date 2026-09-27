import { NextRequest, NextResponse } from "next/server";
import { getTranscriptionSettings, getTranscriptionSettingsRaw, setTranscriptionSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const settings = getTranscriptionSettings();
  const reveal = req.nextUrl.searchParams.get("reveal") === "1";
  return NextResponse.json({ settings, ...(reveal ? { apiKey: getTranscriptionSettingsRaw().apiKey } : {}) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    provider?: string;
    apiKey?: string;
    model?: string;
  };
  const settings = setTranscriptionSettings(body);
  return NextResponse.json({ settings });
}
