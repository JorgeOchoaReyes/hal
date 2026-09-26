import { snapshotRun } from "@/lib/runContext";
import { NextRequest } from "next/server";
import { halState, saveResult } from "@/lib/store";
import { resolveOverriddenTestCase } from "@/lib/runOverrides";
import type { TestResult } from "@hal/core";

export const dynamic = "force-dynamic";
// A batch of runs can take a while; keep the node runtime and a generous cap.
export const runtime = "nodejs";
export const maxDuration = 590;

const MAX_RUNS = 20;

type BatchEvent =
  | { type: "run-started"; index: number; total: number }
  | { type: "run-done"; index: number; total: number; result: TestResult }
  | { type: "batch-done" };

/**
 * Server-Sent Events stream of several runs of the same simulation (a
 * "batch"), dispatched either one after another or all at once. Each
 * completed run is saved and streamed as it finishes, so the client can show
 * per-run progress instead of one live transcript.
 */
export async function GET(req: NextRequest) {
  const testCaseId = req.nextUrl.searchParams.get("testCaseId");
  if (!testCaseId) return new Response("testCaseId required", { status: 400 });

  const targetAgentIdParam = req.nextUrl.searchParams.get("targetAgentId");
  const judgeIdsParam = req.nextUrl.searchParams.get("judgeIds");
  const label = req.nextUrl.searchParams.get("label") || undefined;
  const count = Math.min(MAX_RUNS, Math.max(1, Number(req.nextUrl.searchParams.get("count")) || 1));
  const mode = req.nextUrl.searchParams.get("mode") === "parallel" ? "parallel" : "sequential";

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
      let closed = false;
      const send = (event: BatchEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const handles: Array<{ abort: () => void }> = [];

      async function runOne(index: number): Promise<void> {
        send({ type: "run-started", index, total: count });
        const handle = engine.run(testCase!);
        handles.push(handle);
        const result = await handle.result;
        const labeled: TestResult = { ...result, runLabel: label, context };
        saveResult(labeled);
        send({ type: "run-done", index, total: count, result: labeled });
      }

      async function runAll() {
        try {
          if (mode === "parallel") {
            await Promise.all(Array.from({ length: count }, (_, i) => runOne(i)));
          } else {
            for (let i = 0; i < count; i++) {
              if (closed) break;
              await runOne(i);
            }
          }
        } finally {
          if (!closed) {
            send({ type: "batch-done" });
            controller.enqueue(encoder.encode("event: end\ndata: {}\n\n"));
            closed = true;
            controller.close();
          }
        }
      }

      // Abort every in-flight run if the client disconnects.
      req.signal.addEventListener("abort", () => {
        closed = true;
        for (const h of handles) h.abort();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });

      runAll();
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
