import { NextRequest, NextResponse } from "next/server";
import { getIntegration, id, type HostedTestingAgent } from "@hal/core";
import { getAccountRaw, listAgents, upsertAgent } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ agents: listAgents() });
}

/**
 * Provision a testing agent ON the provider platform, using the stored account
 * credentials, and save the returned external agent id.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    accountId: string;
    name: string;
    systemPrompt: string;
    firstMessage?: string;
    voice?: string;
    model?: string;
  };

  const account = getAccountRaw(body.accountId);
  if (!account) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  const integration = getIntegration(account.provider);
  if (!integration) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  try {
    const { externalAgentId } = await integration.createTestingAgent(account, {
      name: body.name || "HAL tester",
      persona: {
        name: body.name || "HAL tester",
        systemPrompt: body.systemPrompt || "You are a caller testing a voice AI.",
      },
      firstMessage: body.firstMessage,
      voice: body.voice,
      model: body.model,
    });

    const agent: HostedTestingAgent = {
      id: id("agent"),
      accountId: account.id,
      provider: account.provider,
      externalAgentId,
      name: body.name || "HAL tester",
      createdAt: Date.now(),
    };
    upsertAgent(agent);
    return NextResponse.json({ agent }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
