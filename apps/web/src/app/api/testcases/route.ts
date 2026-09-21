import { NextRequest, NextResponse } from "next/server";
import { listTestCases, upsertTestCase } from "@/lib/store";
import type { TestCase } from "@hal/core";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ testCases: listTestCases() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as TestCase;
  if (!body?.id || !body?.scenario || !body?.target || !body?.judge) {
    return NextResponse.json({ error: "Invalid test case" }, { status: 400 });
  }
  upsertTestCase({ ...body, createdAt: body.createdAt ?? Date.now() });
  return NextResponse.json({ testCase: body }, { status: 201 });
}
