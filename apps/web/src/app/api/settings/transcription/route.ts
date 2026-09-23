import { NextRequest, NextResponse } from "next/server";
import { getTranscriptionSettings, setTranscriptionSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ settings: getTranscriptionSettings() });
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
