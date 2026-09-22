import { NextRequest, NextResponse } from "next/server";
import {
  getIntegration,
  id,
  validateStructuredTest,
  type HostedTestingAgent,
  type StructuredTest,
  type TestingAgentSpec,
} from "@hal/core";
import { getAccountRaw, listAgents, upsertAgent, getAgent } from "@/lib/store";

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
    /** When set, edit this existing agent in place instead of creating a new one. */
    agentId?: string;
  };

  const account = getAccountRaw(body.accountId);
  if (!account) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  const integration = getIntegration(account.provider);
  if (!integration) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  // A structured test is compiled to native config by the integration.
  if (body.structured) {
    const errors = validateStructuredTest(body.structured);
    if (errors.length > 0) {
      return NextResponse.json({ error: `Invalid structured test: ${errors.join("; ")}` }, { status: 400 });
    }
  }

  const spec: TestingAgentSpec = {
    name: body.name || "HAL tester",
    persona: {
      name: body.name || "HAL tester",
      systemPrompt: body.systemPrompt || "You are a caller testing a voice AI.",
    },
    firstMessage: body.firstMessage,
    voice: body.voice,
    model: body.model,
    structured: body.structured,
  };

  try {
    const { externalAgentId } = await integration.createTestingAgent(account, spec);

    // Multiple named testing agents per account are allowed. Editing an existing
    // one (agentId given) keeps its HAL id and creation time; otherwise a new
    // agent is created so simulations can choose between several.
    const existing = body.agentId ? getAgent(body.agentId) : undefined;
    const agent: HostedTestingAgent = {
      id: existing?.id ?? id("agent"),
      accountId: account.id,
      provider: account.provider,
      externalAgentId,
      name: body.name || existing?.name || "HAL tester",
      createdAt: existing?.createdAt ?? Date.now(),
      spec,
    };
    upsertAgent(agent);
    return NextResponse.json({ agent, updated: Boolean(existing) }, { status: existing ? 200 : 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
