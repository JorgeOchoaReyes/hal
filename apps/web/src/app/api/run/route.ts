import { NextRequest } from "next/server";
import { halState, getTestCase, saveResult } from "@/lib/store";
import type { RunEvent } from "@hal/core";

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
  const testCase = testCaseId ? getTestCase(testCaseId) : undefined;

  if (!testCase) {
    return new Response("Unknown test case", { status: 404 });
  }

  const encoder = new TextEncoder();
  const { engine } = halState();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: RunEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const handle = engine.run(testCase);
      const unsub = handle.events.on((event) => {
        send(event);
        if (event.type === "done") {
          saveResult(event.result);
          unsub();
          controller.enqueue(encoder.encode("event: end\ndata: {}\n\n"));
          controller.close();
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
