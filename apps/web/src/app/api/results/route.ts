import { NextRequest, NextResponse } from "next/server";
import { listResults } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const testCaseId = req.nextUrl.searchParams.get("testCaseId") ?? undefined;
  return NextResponse.json({ results: listResults(testCaseId) });
}
