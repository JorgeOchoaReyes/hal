import { snapshotRun, hostedContext } from "@/lib/runContext";
import { downloadRunRecording } from "@/lib/runRecordings";
import { NextRequest, NextResponse } from "next/server";
import {
  getIntegration,
  createLLM,
  runHostedCall,
  id,
  type HostedTestingAgent,
  type TestingAgentSpec,
} from "@hal/core";
import { outboundAgentKey, resolveByotKey, getAccountRaw, getTestCase, getAgent, getTarget, getResult, saveResult, upsertAgent } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

declare global {
  var __halInboundRuns: Set<string> | undefined;
}

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
    /** Optional Bland BYOT override for this call only; never persisted. */
    encryptedKey?: string;
    byotKeyId?: string;
    configureInbound?: boolean;
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

  if (testingRef.id && !chosen) return NextResponse.json({ error: "Unknown testing agent" }, { status: 404 });
  if (chosen && chosen.accountId !== body.accountId) {
    return NextResponse.json({ error: "The testing agent belongs to a different provider account. Select its account or use Auto." }, { status: 400 });
  }
  const account = getAccountRaw(body.accountId ?? "");
  if (!account) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  if (body.encryptedKey !== undefined && typeof body.encryptedKey !== "string") {
    return NextResponse.json({ error: "encryptedKey must be a string" }, { status: 400 });
  }
  if (body.byotKeyId !== undefined && typeof body.byotKeyId !== "string") return NextResponse.json({ error: "byotKeyId must be a string" }, { status: 400 });
  if (body.byotKeyId && body.encryptedKey?.trim()) return NextResponse.json({ error: "Select a saved key or enter a key, not both" }, { status: 400 });
  const dispatchKey = body.byotKeyId ? resolveByotKey(account.id, body.byotKeyId) : body.encryptedKey?.trim() || undefined;
  if (body.byotKeyId && !dispatchKey) return NextResponse.json({ error: "Saved BYOT key not found for this account. Select it again." }, { status: 400 });
  if (dispatchKey && account.provider !== "bland") {
    return NextResponse.json({ error: "The dispatch BYOT encrypted key is only supported for Bland." }, { status: 400 });
  }
  const integration = getIntegration(account.provider);
  if (!integration) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  const outboundIsTarget = body.outboundAgent.kind === "target";
  if (outboundIsTarget) {
    if (targetAgent.provider && targetAgent.provider !== account.provider) {
      return NextResponse.json({ error: "The outbound agent and selected account must use the same provider." }, { status: 400 });
    }
    if (!body.configureInbound || !integration.configureInbound) {
      return NextResponse.json({ error: "Confirm that HAL may configure the dedicated inbound test number. This provider must support inbound configuration." }, { status: 400 });
    }
    if (account.provider === "bland" && !testCase.scenario.structured && !testCase.scenario.steps?.length) {
      return NextResponse.json({ error: "Inbound Bland testing requires a structured simulation so HAL can assign its pathway to the test number." }, { status: 400 });
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

  let callerKey: string | undefined;
  try { callerKey = account.provider === "bland" && body.fromNumber === "" ? undefined : dispatchKey ?? outboundAgentKey(account.id, outboundIsTarget ? targetAgent : chosen ?? {}); }
  catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 400 }); }
  const spec: TestingAgentSpec = {
    name: chosen?.name ?? `${testCase.name} (${account.provider})`,
    persona: testCase.scenario.persona,
    firstMessage: undefined,
    voice: chosen?.spec?.voice,
    model: chosen?.spec?.model,
    structured: testCase.scenario.structured,
    steps: testCase.scenario.structured ? undefined : testCase.scenario.steps,
  };

  // Validate before provisioning so unsupported steps cannot become a persona-only call.
  if (spec.steps?.length) {
    if (account.provider !== "bland") return NextResponse.json({ error: "Hosted linear scripts currently require Bland. Use a structured simulation for this provider. No call was placed." }, { status: 400 });
    try { integration.buildFlowConfig(spec); }
    catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 400 }); }
  }
  const initialContext = snapshotRun(testCase);

  // Prevent a second dispatch from replacing the receiving pathway mid-call.
  const inboundRuns = globalThis.__halInboundRuns ??= new Set<string>();
  const inboundKey = outboundIsTarget ? `${account.id}:${body.phoneNumber.replace(/[\s().-]/g, "")}` : undefined;
  if (inboundKey && inboundRuns.has(inboundKey)) {
    return NextResponse.json({ error: "This inbound test number already has a run in progress." }, { status: 409 });
  }
  if (inboundKey) inboundRuns.add(inboundKey);
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
      encryptedKey: chosen?.encryptedKey,
      byotKeyId: chosen?.byotKeyId,
      byotAccountId: chosen?.byotAccountId,
    };
    upsertAgent(agent);

    if (outboundIsTarget) await integration.configureInbound!(account, agent, body.phoneNumber);

    const context = hostedContext(initialContext, account, agent, body.phoneNumber, targetAgent, outboundIsTarget,
      body.fromNumber === undefined ? account.credentials.from : body.fromNumber);
    if (!outboundIsTarget && targetAgent.provider === "bland" && integration.getInboundPathway) {
      try {
        const pathwayId = await integration.getInboundPathway(account, body.phoneNumber);
        if (pathwayId) { context.targetAgent.pathwayId = pathwayId; context.targetAgent.pathwaySource = "inbound-number"; }
      } catch { /* A target on another account may not be visible. Preserve the unverified marker. */ }
    }
    const result = await runHostedCall({
      testCaseId: testCase.id,
      integration,
      providerAgentRole: outboundIsTarget ? "target" : "agent",
      // Leave time for provisioning, final evaluation, and saving within the route budget.
      timeoutMs: 180_000,
      account,
      agent: { ...agent, encryptedKey: outboundIsTarget ? undefined : callerKey },
      target: { phoneNumber: body.phoneNumber, fromNumber: body.fromNumber },
      judge: testCase.judge,
      llm: createLLM(testCase.judge.provider ?? "auto", testCase.judge.model),
      place: outboundIsTarget
        ? () =>
            integration.placeOutboundCall!(
              account,
              { externalAgentId: targetAgent.externalAgentId!, encryptedKey: callerKey },
              { phoneNumber: body.phoneNumber, fromNumber: body.fromNumber },
            )
        : undefined,
    });
    result.context = context;
    result.recordingSource = { provider: account.provider, accountId: account.id };
    saveResult(result);
    if (result.externalCallId && integration.getRecording) await downloadRunRecording(result.id);
    return NextResponse.json({ result: getResult(result.id), agentId: agent.id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  } finally {
    if (inboundKey) inboundRuns.delete(inboundKey);
  }
}
