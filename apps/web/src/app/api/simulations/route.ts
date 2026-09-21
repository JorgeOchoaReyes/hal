import { NextRequest, NextResponse } from "next/server";
import {
  getProviderTemplate,
  id,
  type ScenarioStep,
  type JudgeRule,
  type Persona,
  type TestCase,
} from "@hal/core";
import { upsertTestCase } from "@/lib/store";

export const dynamic = "force-dynamic";

interface SimulationDraft {
  name: string;
  providerId: string;
  targetConfig: Record<string, string>;
  persona: Persona;
  steps: ScenarioStep[];
  judge: {
    rules?: JudgeRule[];
    criteria?: string[];
    mode?: "all" | "rules-only" | "llm-only";
  };
  tags?: string[];
  maxTurns?: number;
  maxDurationMs?: number;
}

/**
 * Create a simulation (test case) from a draft. The provider template turns the
 * collected config into a concrete target server-side, so the UI never needs to
 * know transport internals.
 */
export async function POST(req: NextRequest) {
  const draft = (await req.json()) as SimulationDraft;

  if (!draft?.name || !draft?.providerId) {
    return NextResponse.json({ error: "name and providerId are required" }, { status: 400 });
  }
  const template = getProviderTemplate(draft.providerId);
  if (!template) {
    return NextResponse.json({ error: `Unknown provider "${draft.providerId}"` }, { status: 400 });
  }

  const missing = template.fields
    .filter((f) => f.required && !draft.targetConfig?.[f.key]?.trim())
    .map((f) => f.label);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required fields: ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  const persona: Persona = {
    name: draft.persona?.name || "Caller",
    systemPrompt: draft.persona?.systemPrompt || "You are a caller testing a voice AI.",
    temperature: draft.persona?.temperature,
    voice: draft.persona?.voice,
  };

  const testCase: TestCase = {
    id: id("tc"),
    name: draft.name,
    createdAt: Date.now(),
    tags: draft.tags,
    scenario: {
      id: id("scn"),
      name: draft.name,
      persona,
      steps: draft.steps ?? [],
      maxTurns: draft.maxTurns,
      maxDurationMs: draft.maxDurationMs,
    },
    target: template.buildTarget(`${draft.name} target`, draft.targetConfig ?? {}),
    judge: {
      mode: draft.judge?.mode ?? "all",
      rules: draft.judge?.rules ?? [],
      criteria: draft.judge?.criteria ?? [],
    },
  };

  upsertTestCase(testCase);
  return NextResponse.json({ testCase }, { status: 201 });
}
