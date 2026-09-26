import { NextRequest, NextResponse } from "next/server";
import {
  getIntegration,
  id,
  validateStructuredTest,
  type HostedTestingAgent,
  type StructuredTest,
  type TestingAgentSpec,
  type ScenarioStep,
} from "@hal/core";
import { publicAgent, resolveByotKey, getAccountRaw, listAgents, upsertAgent, getAgent } from "@/lib/store";

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
    steps?: ScenarioStep[];
    /** Optional: run against an existing provider pathway id (e.g. a Bland Pathway). */
    pathwayId?: string;
    /** When set, edit this existing agent in place instead of creating a new one. */
    agentId?: string;
    /**
     * Per-agent provider secret used to dispatch an outbound call from this
     * agent (e.g. Bland's encrypted key). Stored as given, not re-encrypted.
     */
    encryptedKey?: string;
    byotKeyId?: string;
    byotAccountId?: string;
  };

  const account = getAccountRaw(body.accountId);
  if (!account) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  const integration = getIntegration(account.provider);
  if (!integration) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  const existing = body.agentId ? getAgent(body.agentId) : undefined;
  if (body.agentId && (!existing || existing.accountId !== account.id)) return NextResponse.json({ error: "Unknown testing agent for this account" }, { status: 404 });
  if (body.byotKeyId && (account.provider !== "bland" || !resolveByotKey(account.id, body.byotKeyId))) return NextResponse.json({ error: "Saved BYOT key not found for this account" }, { status: 400 });
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
    steps: body.steps,
    pathwayId: body.pathwayId?.trim() || undefined,
  };

  try {
    const { externalAgentId } = existing && JSON.stringify(existing.spec) === JSON.stringify(spec) ? existing : await integration.createTestingAgent(account, spec);

    // Multiple named testing agents per account are allowed. Editing an existing
    // one (agentId given) keeps its HAL id and creation time; otherwise a new
    // agent is created so simulations can choose between several.

    const agent: HostedTestingAgent = {
      id: existing?.id ?? id("agent"),
      accountId: account.id,
      provider: account.provider,
      externalAgentId,
      name: body.name || existing?.name || "HAL tester",
      createdAt: existing?.createdAt ?? Date.now(),
      spec,
      encryptedKey: body.encryptedKey !== undefined ? body.encryptedKey.trim() || undefined : existing?.encryptedKey,
      byotKeyId: body.byotKeyId !== undefined ? body.byotKeyId || undefined : existing?.byotKeyId,
      byotAccountId: account.id,
    };
    upsertAgent(agent);
    return NextResponse.json({ agent: publicAgent(agent), updated: Boolean(existing) }, { status: existing ? 200 : 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
