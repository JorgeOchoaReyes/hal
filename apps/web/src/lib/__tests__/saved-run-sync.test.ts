import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../../app/api/results/[id]/sync/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;

test("history sync refreshes both calls and audio while preserving the original verdict", async () => {
  const verdict = { passed: false, summary: "Original evaluation", score: 0, checks: [] };
  let saved: any = { id: "run1", status: "failed", externalCallId: "outbound", startedAt: 1000,
    transcript: [{ role: "agent", text: "old", startedAt: 1000 }], verdict, evaluations: [{ id: "judge2" }],
    trace: [{ side: "testingAgent", kind: "event", label: "old" }],
    context: { account: { id: "vapi-account", provider: "vapi" },
      testingAgent: { direction: "outbound", phoneNumber: "+14155550101" },
      targetAgent: { provider: "retell", phoneNumber: "+14155550100", externalAgentId: "retell-agent" } },
  };
  let download: { id: string; force: boolean } | undefined;
  const integrations: Record<string, any> = {
    vapi: { id: "vapi", getRecording: async () => new Response(), getCall: async () => ({ status: "ended",
      details: { metadata: { final: true } }, trace: [{ kind: "tool-call", label: "lookup" }],
      transcript: [{ role: "agent", text: "new", startedAt: 1000, audioStartMs: 700 }] }) },
    retell: { id: "retell", findInboundCall: async () => "inbound", getCall: async () => ({
      details: { analysis: { success: true } }, trace: [{ kind: "node", label: "welcome" }],
    }) },
  };
  const context = { exports: {} as { POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> },
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "@hal/core") return { getIntegration: (id: string) => integrations[id] };
      if (name === "@/lib/store") return { getResult: () => saved, saveResult: (value: unknown) => { saved = value; },
        listAccounts: () => [{ id: "retell-account", provider: "retell" }],
        getAccountRaw: (id: string) => ({ id, provider: id === "vapi-account" ? "vapi" : "retell" }) };
      if (name === "@/lib/runRecordings") return { downloadRunRecording: async (id: string, force: boolean) => { download = { id, force }; } };
      throw new Error(`Unexpected dependency: ${name}`);
    } };
  runInNewContext(compiled, context);
  const response = await context.exports.POST(new Request("http://localhost"), { params: Promise.resolve({ id: "run1" }) });
  assert.equal(response.status, 200);
  assert.equal(saved.status, "failed");
  assert.equal(saved.verdict, verdict);
  assert.equal(saved.evaluations.length, 1);
  assert.equal(saved.transcript[0].text, "new");
  assert.equal(saved.transcript[0].audioStartMs, 700);
  assert.equal(saved.providerCalls.testingAgent.details.metadata.final, true);
  assert.equal(saved.providerCalls.targetAgent.details.analysis.success, true);
  assert.equal(saved.trace.map((event: any) => event.side).join(","), "testingAgent,targetAgent");
  assert.deepEqual(download, { id: "run1", force: true });
});
