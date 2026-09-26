import { NextRequest, NextResponse } from "next/server";
import { getTestCase, getTestCaseRaw, deleteTestCase, upsertTestCase } from "@/lib/store";

import { validateScenario } from "@/lib/scenarioValidation";
import type { Scenario } from "@hal/core";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tc = getTestCase(id);
  if (!tc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ testCase: tc });
}

/** Update editable scenario fields or attached judges without replacing other settings. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = getTestCaseRaw(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || (!body.scenario && !Array.isArray(body.judgeIds))) return NextResponse.json({ error: "Provide scenario or judgeIds" }, { status: 400 });
  if (body.judgeIds !== undefined && (!Array.isArray(body.judgeIds) || body.judgeIds.some((id: unknown) => typeof id !== "string"))) return NextResponse.json({ error: "judgeIds must be an array of IDs" }, { status: 400 });
  if (body.scenario) {
    const error = validateScenario(body.scenario);
    if (error) return NextResponse.json({ error }, { status: 400 });
    if (body.expectedScenario && JSON.stringify(body.expectedScenario) !== JSON.stringify(existing.scenario)) return NextResponse.json({ error: "This scenario changed elsewhere. Cancel and reopen the editor to load the latest version." }, { status: 409 });
  }
  const input = body.scenario as Scenario | undefined;
  const scenario = input ? { ...existing.scenario, persona: { ...existing.scenario.persona, name: input.persona.name, systemPrompt: input.persona.systemPrompt }, description: input.description, steps: input.steps, structured: input.structured } : existing.scenario;
  upsertTestCase({ ...existing, scenario, ...(body.judgeIds ? { judgeIds: body.judgeIds } : {}) });
  return NextResponse.json({ testCase: getTestCase(id) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = deleteTestCase(id);
  return NextResponse.json({ deleted: ok }, { status: ok ? 200 : 404 });
}
