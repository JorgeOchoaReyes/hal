import { NextRequest, NextResponse } from "next/server";
import {
  getIntegration,
  validateStructuredTest,
  type StructuredTest,
  type TestingAgentSpec,
} from "@hal/core";

export const dynamic = "force-dynamic";

/**
 * Preview the NATIVE agent config a provider would be given for a spec /
 * structured test — the step-by-step reproduction, without provisioning.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    provider: string;
    name?: string;
    systemPrompt?: string;
    firstMessage?: string;
    structured?: StructuredTest;
  };

  const integration = getIntegration(body.provider);
  if (!integration) {
    return NextResponse.json({ error: `Unknown provider "${body.provider}"` }, { status: 400 });
  }
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
    structured: body.structured,
  };

  return NextResponse.json({ provider: integration.id, config: integration.buildAgentConfig(spec) });
}
