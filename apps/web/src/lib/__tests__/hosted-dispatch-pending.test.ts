import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("hosted dispatch saves a running result as soon as the provider returns a call ID", async () => {
  const source = readFileSync(new URL("../../app/api/run-hosted-sim/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let saved: Record<string, unknown> | undefined;
  let placed = false;
  const integration = {
    buildFlowConfig: () => ({}),
    listAvailableVoices: async () => ["target-voice", "tester-voice"],
    createTestingAgent: async () => ({ externalAgentId: "tester-agent" }),
    placeCall: async () => { placed = true; return { externalCallId: "provider-call" }; },
    getCall: async () => { throw new Error("Dispatch must not wait for the call to end"); },
  };
  const dependencies: Record<string, unknown> = {
    "@hal/core": { getIntegration: () => integration, id: () => "agent-1", createLLM: () => ({}),
      runHostedCall: async () => { throw new Error("Dispatch must not wait for the call to end"); } },
    "@/lib/store": {
      getTestCase: () => ({ id: "sim-1", name: "Test", scenario: { persona: { name: "Customer", systemPrompt: "Be direct" } }, judge: {} }),
      getAgent: () => undefined,
      getTarget: () => ({ id: "target-1", name: "Target", provider: "bland", voiceId: "target-voice" }),
      getAccountRaw: () => ({ id: "account-1", label: "Bland", provider: "bland", credentials: {} }),
      outboundAgentKey: () => undefined,
      upsertAgent: () => {},
      saveResult: (result: Record<string, unknown>) => { saved = result; },
      getResult: () => saved,
      listResults: () => saved ? [saved] : [],
    },
    "@/lib/runContext": { snapshotRun: () => ({ judge: {} }), hostedContext: () => ({ account: { id: "account-1", provider: "bland" }, judge: {}, targetAgent: { direction: "inbound" } }) },
  };
  const context = {
    exports: {} as { POST: (req: { json: () => Promise<unknown> }) => Promise<Response> },
    require: (name: string) => name === "next/server" ? { NextResponse: Response } : dependencies[name],
  };
  runInNewContext(compiled, context);
  const response = await context.exports.POST({ json: async () => ({
    testCaseId: "sim-1", accountId: "account-1", phoneNumber: "+14155550123",
    inboundAgent: { kind: "target", id: "target-1" }, outboundAgent: { kind: "testing", id: "" },
  }) });
  assert.equal(response.status, 200, await response.clone().text());
  const data = await response.json();
  assert.equal(placed, true);
  assert.equal(data.result.id, saved?.id);
  assert.equal(saved?.externalCallId, "provider-call");
  assert.equal(saved?.status, "running");
  assert.equal(saved?.endedAt, undefined);
});
