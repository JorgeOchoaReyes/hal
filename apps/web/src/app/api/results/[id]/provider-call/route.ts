import { NextResponse } from "next/server";
import { getIntegration } from "@hal/core";
import { getAccountRaw, getResult, saveResult } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Attach or refresh the independent provider record for either participant. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getResult(id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  const body = await req.json().catch(() => ({})) as { side?: string; accountId?: string; externalCallId?: string };
  if (body.side !== "testingAgent" && body.side !== "targetAgent") {
    return NextResponse.json({ error: "Choose the testing agent or agent under test." }, { status: 400 });
  }
  const callId = body.externalCallId?.trim();
  if (!callId || !body.accountId) return NextResponse.json({ error: "Provider account and call ID are required." }, { status: 400 });
  const account = getAccountRaw(body.accountId);
  if (!account) return NextResponse.json({ error: "Provider account not found." }, { status: 404 });
  const expectedProvider = run.context?.[body.side].provider;
  if (expectedProvider && account.provider !== expectedProvider) {
    return NextResponse.json({ error: "This account uses a different provider than the selected agent." }, { status: 400 });
  }
  const integration = getIntegration(account.provider);
  if (!integration) return NextResponse.json({ error: "Provider integration unavailable." }, { status: 400 });
  try {
    const call = await integration.getCall(account, callId);
    if (!call.details) return NextResponse.json({ error: "The provider returned no call details." }, { status: 502 });
    const latest = getResult(id)!;
    saveResult({ ...latest,
      providerCalls: { ...latest.providerCalls, [body.side]: {
        provider: account.provider, accountId: account.id, externalCallId: callId,
        fetchedAt: Date.now(), details: call.details, events: call.events,
      } },
      trace: [...(latest.trace ?? []).filter((event) => event.side !== body.side),
        ...(call.trace ?? []).map((event) => ({ ...event, side: body.side! as "testingAgent" | "targetAgent" }))],
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
