import { NextRequest, NextResponse } from "next/server";
import { getTestCase, deleteTestCase, setTestCaseJudges } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tc = getTestCase(id);
  if (!tc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ testCase: tc });
}

/** Attach/replace the reusable judges on a simulation. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { judgeIds?: string[] };
  if (!Array.isArray(body.judgeIds)) {
    return NextResponse.json({ error: "judgeIds must be an array" }, { status: 400 });
  }
  const tc = setTestCaseJudges(id, body.judgeIds);
  if (!tc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ testCase: tc });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = deleteTestCase(id);
  return NextResponse.json({ deleted: ok }, { status: ok ? 200 : 404 });
}
