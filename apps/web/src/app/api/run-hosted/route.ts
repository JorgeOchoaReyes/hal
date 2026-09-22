import { NextRequest, NextResponse } from "next/server";
import { getIntegration, createLLM, runHostedCall, type JudgeSpec } from "@hal/core";
import { getAccountRaw, getAgent, saveResult } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Place a call from a hosted testing agent to a target number, poll the
 * platform to completion, and judge the transcript. Returns the final result.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    agentId: string;
    phoneNumber: string;
    judge?: JudgeSpec;
    testCaseId?: string;
  };

  const agent = getAgent(body.agentId);
  if (!agent) return NextResponse.json({ error: "Unknown agent" }, { status: 404 });
  const account = getAccountRaw(agent.accountId);
  if (!account) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  const integration = getIntegration(account.provider);
  if (!integration) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  if (!body.phoneNumber) return NextResponse.json({ error: "phoneNumber required" }, { status: 400 });

  const result = await runHostedCall({
    testCaseId: body.testCaseId ?? `hosted:${agent.id}`,
    integration,
    account,
    agent,
    target: { phoneNumber: body.phoneNumber },
    judge: body.judge ?? { mode: "llm-only", criteria: ["The call completed successfully."] },
    llm: createLLM("auto"),
  });

  saveResult(result);
  return NextResponse.json({ result });
}
