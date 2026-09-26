import { snapshotRun } from "@/lib/runContext";
import { NextRequest } from "next/server";
import { halState, saveResult } from "@/lib/store";
import { resolveOverriddenTestCase } from "@/lib/runOverrides";
import type { RunEvent, TestResult } from "@hal/core";

export const dynamic = "force-dynamic";
// Runs may outlive the default serverless timeout; keep the node runtime.
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Server-Sent Events stream of a single test run. The browser opens this with
 * EventSource and renders utterances, live checks, and the final verdict as
 * they arrive.
 */
export async function GET(req: NextRequest) {
  const testCaseId = req.nextUrl.searchParams.get("testCaseId");
  if (!testCaseId) return new Response("testCaseId required", { status: 400 });

  const targetAgentIdParam = req.nextUrl.searchParams.get("targetAgentId");
  const judgeIdsParam = req.nextUrl.searchParams.get("judgeIds");
  const label = req.nextUrl.searchParams.get("label") || undefined;

  const { testCase, error, status } = resolveOverriddenTestCase(testCaseId, {
    targetAgentId: targetAgentIdParam,
    judgeIds: judgeIdsParam !== null ? judgeIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : null,
  });
  if (error || !testCase) {
    return new Response(error ?? "Unknown test case", { status: status ?? 404 });
  }

  const context = snapshotRun(testCase);
  const encoder = new TextEncoder();
  const { engine } = halState();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: RunEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const handle = engine.run(testCase);
      const unsub = handle.events.on((event) => {
        if (event.type === "done") {
          const result: TestResult = { ...event.result, runLabel: label, context };
          saveResult(result);
          send({ ...event, result });
          unsub();
          controller.enqueue(encoder.encode("event: end\ndata: {}\n\n"));
          controller.close();
        } else {
          send(event);
        }
      });

      // Abort the run if the client disconnects.
      req.signal.addEventListener("abort", () => {
        handle.abort();
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
