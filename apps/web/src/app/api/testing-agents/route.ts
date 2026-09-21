import { NextRequest, NextResponse } from "next/server";
import {
  getIntegration,
  id,
  validateStructuredTest,
  compileStructuredToPrompt,
  type HostedTestingAgent,
  type StructuredTest,
} from "@hal/core";
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
    systemPrompt?: string;
    firstMessage?: string;
    voice?: string;
    model?: string;
    /** Optional: compile a structured test into the agent's deterministic prompt. */
    structured?: StructuredTest;
  };

  const account = getAccountRaw(body.accountId);
  if (!account) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  const integration = getIntegration(account.provider);
  if (!integration) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  // A structured test compiles to a deterministic prompt for the hosted agent.
  let systemPrompt = body.systemPrompt || "You are a caller testing a voice AI.";
  if (body.structured) {
    const errors = validateStructuredTest(body.structured);
    if (errors.length > 0) {
      return NextResponse.json({ error: `Invalid structured test: ${errors.join("; ")}` }, { status: 400 });
    }
    systemPrompt = compileStructuredToPrompt(body.structured);
  }

  const spec = {
    name: body.name || "HAL tester",
    persona: { name: body.name || "HAL tester", systemPrompt },
    firstMessage: body.firstMessage,
    voice: body.voice,
    model: body.model,
  };

  try {
    const { externalAgentId } = await integration.createTestingAgent(account, spec);

    const agent: HostedTestingAgent = {
      id: id("agent"),
      accountId: account.id,
      provider: account.provider,
      externalAgentId,
      name: body.name || "HAL tester",
      createdAt: Date.now(),
      spec,
    };
    upsertAgent(agent);
    return NextResponse.json({ agent }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
