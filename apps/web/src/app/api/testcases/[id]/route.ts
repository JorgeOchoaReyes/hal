import { NextRequest, NextResponse } from "next/server";
import { getTestCase, deleteTestCase } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tc = getTestCase(id);
  if (!tc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ testCase: tc });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = deleteTestCase(id);
  return NextResponse.json({ deleted: ok }, { status: ok ? 200 : 404 });
}
