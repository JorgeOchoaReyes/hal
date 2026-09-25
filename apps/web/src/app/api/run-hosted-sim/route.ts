import { NextRequest, NextResponse } from "next/server";
import {
  getIntegration,
  createLLM,
  runHostedCall,
  id,
  type HostedTestingAgent,
  type TestingAgentSpec,
} from "@hal/core";
import { getAccountRaw, getTestCase, getAgent, getTarget, saveResult, upsertAgent } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

interface AgentRef {
  kind: "testing" | "target";
  id: string;
}

/**
 * Ad-hoc dispatch: take a saved simulation, compile it into a testing agent on
 * the chosen provider AT DISPATCH TIME (node-based when the platform supports
 * it), place the call, poll to completion, and judge the transcript.
 *
 * Either side of the call — the agent that waits ("inbound") and the agent
 * that places the call ("outbound") — can be any saved agent (a HAL-managed
 * testing agent, or a saved agent under test). Exactly one of the two must be
 * a testing agent: HAL always dispatches/judges through one it manages, the
 * other is the real agent being tested.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    testCaseId: string;
    accountId: string;
    /** The inbound agent's own number — the one the outbound side dials. */
    phoneNumber: string;
    /** The outbound agent's own number — its caller id for this call. */
    fromNumber?: string;
    inboundAgent?: AgentRef;
    outboundAgent?: AgentRef;
  };

  const testCase = getTestCase(body.testCaseId);
  if (!testCase) return NextResponse.json({ error: "Unknown simulation" }, { status: 404 });
  if (!body.phoneNumber) return NextResponse.json({ error: "phoneNumber required" }, { status: 400 });
  if (!body.inboundAgent || !body.outboundAgent) {
    return NextResponse.json({ error: "inboundAgent and outboundAgent are required" }, { status: 400 });
  }
  if (body.inboundAgent.kind === body.outboundAgent.kind && body.inboundAgent.id === body.outboundAgent.id) {
    return NextResponse.json({ error: "Inbound and outbound must be different agents" }, { status: 400 });
  }

  const refs = [body.inboundAgent, body.outboundAgent];
  const testingRef = refs.find((r) => r.kind === "testing");
  const targetRef = refs.find((r) => r.kind === "target");
  if (!testingRef || !targetRef) {
    return NextResponse.json(
      { error: "One side must be a testing agent and the other a saved agent under test." },
      { status: 400 },
    );
  }

  const chosen = getAgent(testingRef.id);
  const targetAgent = getTarget(targetRef.id);
  if (!targetAgent) return NextResponse.json({ error: "Unknown agent under test" }, { status: 404 });

  const account = getAccountRaw(chosen?.accountId ?? body.accountId ?? "");
  if (!account) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  const integration = getIntegration(account.provider);
  if (!integration) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  const outboundIsTarget = body.outboundAgent.kind === "target";
  if (outboundIsTarget) {
    if (!targetAgent.externalAgentId) {
      return NextResponse.json(
        { error: `"${targetAgent.name}" has no pathway/agent id set — add one on its "My agents" entry.` },
        { status: 400 },
      );
    }
    if (!integration.placeOutboundCall) {
      return NextResponse.json(
        { error: `${account.provider} doesn't support outbound dispatch yet.` },
        { status: 400 },
      );
    }
  }

  const spec: TestingAgentSpec = {
    name: chosen?.name ?? `${testCase.name} (${account.provider})`,
    persona: testCase.scenario.persona,
    firstMessage: undefined,
    structured: testCase.scenario.structured,
  };

  try {
    // The testing agent side is always reconfigured to match this simulation
    // before the call — whether it's the one waiting or the one dialing.
    const { externalAgentId } = await integration.createTestingAgent(account, spec);
    const agent: HostedTestingAgent = {
      id: chosen?.id ?? id("agent"),
      accountId: account.id,
      provider: account.provider,
      externalAgentId,
      name: spec.name,
      createdAt: chosen?.createdAt ?? Date.now(),
      spec,
    };
    upsertAgent(agent);

    const result = await runHostedCall({
      testCaseId: testCase.id,
      integration,
      account,
      agent,
      target: { phoneNumber: body.phoneNumber, fromNumber: body.fromNumber },
      judge: testCase.judge,
      llm: createLLM(testCase.judge.provider ?? "auto", testCase.judge.model),
      place: outboundIsTarget
        ? () =>
            integration.placeOutboundCall!(
              account,
              { externalAgentId: targetAgent.externalAgentId!, encryptedKey: targetAgent.encryptedKey },
              { phoneNumber: body.phoneNumber, fromNumber: body.fromNumber },
            )
        : undefined,
    });
    saveResult(result);
    return NextResponse.json({ result, agentId: agent.id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
