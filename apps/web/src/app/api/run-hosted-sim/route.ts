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
    /**
     * Which side places the call. `"inbound"` (default) is today's flow: the
     * testing agent (HAL's caller) dials `phoneNumber`, the agent under
     * test's own number. `"outbound"` flips it: the agent under test's own
     * pathway is triggered to call `phoneNumber` — the testing agent's own
     * number, already wired to answer it on the provider.
     */
    direction?: "inbound" | "outbound";
  };

  const testCase = getTestCase(body.testCaseId);
  if (!testCase) return NextResponse.json({ error: "Unknown simulation" }, { status: 404 });
  if (!body.phoneNumber) return NextResponse.json({ error: "phoneNumber required" }, { status: 400 });

  const targetAgent = testCase.targetAgentId ? getTarget(testCase.targetAgentId) : undefined;
  const direction = body.direction ?? targetAgent?.direction ?? "inbound";

  // A simulation can name the testing agent (caller/receiver) to run with. When
  // set, that agent's account is used and the agent is reconfigured for this
  // simulation; otherwise dispatch provisions an ad-hoc agent on the given account.
  const chosen = getAgent(body.testingAgentId ?? testCase.testingAgentId ?? "");
  const account = getAccountRaw(chosen?.accountId ?? body.accountId ?? "");
  if (!account) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  const integration = getIntegration(account.provider);
  if (!integration) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  // Outbound requires a saved agent under test with its own pathway id (to
  // know which pathway to trigger) — validate up front with a clear message.
  if (direction === "outbound") {
    if (!targetAgent) {
      return NextResponse.json(
        { error: "Outbound dispatch requires a saved agent under test (with its own pathway id and key)." },
        { status: 400 },
      );
    }
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
    // Reconfigure the chosen agent for this simulation, or create ad-hoc. In
    // outbound direction this is the WAITING agent (the one the target calls
    // into), so it still needs to be live with this simulation's content.
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
      llm: createLLM(testCase.judge.provider ?? "auto", testCase.judge.model),
      place:
        direction === "outbound" && targetAgent?.externalAgentId
          ? () =>
              integration.placeOutboundCall!(
                account,
                { externalAgentId: targetAgent.externalAgentId!, encryptedKey: targetAgent.encryptedKey },
                { phoneNumber: body.phoneNumber },
              )
          : undefined,
    });
    saveResult(result);
    return NextResponse.json({ result, agentId: agent.id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
