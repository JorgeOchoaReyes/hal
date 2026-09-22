import { NextRequest, NextResponse } from "next/server";
import {
  getIntegration,
  createLLM,
  runHostedCall,
  id,
  type HostedTestingAgent,
  type TestingAgentSpec,
} from "@hal/core";
import { getAccountRaw, getTestCase, getAgent, saveResult, upsertAgent } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Ad-hoc dispatch: take a saved simulation, compile it into a testing agent on
 * the chosen provider AT DISPATCH TIME (node-based when the platform supports
 * it), place the call, poll to completion, and judge the transcript.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    testCaseId: string;
    accountId?: string;
    phoneNumber: string;
    /** Optional override of the simulation's chosen testing agent. */
    testingAgentId?: string;
  };

  const testCase = getTestCase(body.testCaseId);
  if (!testCase) return NextResponse.json({ error: "Unknown simulation" }, { status: 404 });
  if (!body.phoneNumber) return NextResponse.json({ error: "phoneNumber required" }, { status: 400 });

  // A simulation can name the testing agent (caller) to run with. When set, that
  // agent's account is used and the agent is reconfigured for this simulation;
  // otherwise dispatch provisions an ad-hoc agent on the given account.
  const chosen = getAgent(body.testingAgentId ?? testCase.testingAgentId ?? "");
  const account = getAccountRaw(chosen?.accountId ?? body.accountId ?? "");
  if (!account) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  const integration = getIntegration(account.provider);
  if (!integration) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  const spec: TestingAgentSpec = {
    name: chosen?.name ?? `${testCase.name} (${account.provider})`,
    persona: testCase.scenario.persona,
    firstMessage: undefined,
    structured: testCase.scenario.structured,
  };

  try {
    // Reconfigure the chosen agent for this simulation, or create ad-hoc.
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
      target: { phoneNumber: body.phoneNumber },
      judge: testCase.judge,
      llm: createLLM("auto"),
    });
    saveResult(result);
    return NextResponse.json({ result, agentId: agent.id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
