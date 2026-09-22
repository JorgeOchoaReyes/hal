import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Check {
  configured: boolean;
  ok?: boolean;
  detail?: string;
}

async function timed(url: string, headers: Record<string, string>): Promise<Check> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (res.ok) return { configured: true, ok: true };
    const body = await res.text().catch(() => "");
    return { configured: true, ok: false, detail: `${res.status}: ${body.slice(0, 200)}` };
  } catch (err) {
    return { configured: true, ok: false, detail: (err as Error).message };
  } finally {
    clearTimeout(t);
  }
}

/** Pre-flight for the HAL-driven telephony path: Twilio + Deepgram credentials. */
export async function GET() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const dg = process.env.DEEPGRAM_API_KEY;

  const twilio: Check = sid && token
    ? await timed(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
        authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      })
    : { configured: false };

  const deepgram: Check = dg
    ? await timed("https://api.deepgram.com/v1/projects", { authorization: `Token ${dg}` })
    : { configured: false };

  return NextResponse.json({
    twilio,
    deepgram,
    from: process.env.TWILIO_FROM_NUMBER ? "set" : "missing",
    publicUrl: process.env.HAL_PUBLIC_URL ?? null,
  });
}
