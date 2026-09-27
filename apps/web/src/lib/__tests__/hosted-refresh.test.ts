import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../../app/api/results/[id]/refresh/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test("a pending hosted call check uses the saved account and updates the same run", async () => {
  let saved: any = {
    id: "run1", testCaseId: "tc1", status: "running", externalCallId: "call1", transcript: [],
    context: { account: { id: "account1", provider: "bland" },
      targetAgent: { direction: "inbound" }, judge: { mode: "rules-only" } },
  };
  let checked = false;
  const context = { exports: {} as { POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> },
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "@/lib/store") return {
        getResult: () => saved, saveResult: (result: unknown) => { saved = result; }, listAccounts: () => [],
        getAccountRaw: (id: string) => id === "account1" ? { id, provider: "bland" } : undefined,
      };
      if (name === "@hal/core") return {
        createLLM: () => ({}), getIntegration: () => ({ id: "bland" }),
        refreshHostedCall: async (opts: any) => {
          checked = true;
          assert.equal(opts.result.externalCallId, "call1");
          assert.equal(opts.account.id, "account1");
          assert.equal(opts.providerAgentRole, "agent");
          return { state: "completed", result: { ...opts.result, status: "passed", transcript: [{ role: "agent", text: "done" }], error: undefined } };
        },
      };
      if (name === "@/lib/runRecordings") return { downloadRunRecording: () => {} };
      throw new Error(`Unexpected dependency: ${name}`);
    } };
  runInNewContext(compiled, context);
  const response = await context.exports.POST(new Request("http://localhost"), { params: Promise.resolve({ id: "run1" }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state, "completed");
  assert.equal(saved.id, "run1");
  assert.equal(saved.status, "passed");
  assert.equal(checked, true);
});

test("refresh links a uniquely matched inbound Bland call to the receiving agent", async () => {
  let saved: any = { id: "run2", status: "running", externalCallId: "outbound", startedAt: 1000,
    transcript: [], context: { account: { id: "account1", provider: "bland" }, judge: { mode: "rules-only" },
      testingAgent: { provider: "bland", direction: "outbound", phoneNumber: "+14155550101" },
      targetAgent: { provider: "bland", direction: "inbound", phoneNumber: "+14155550100" } } };
  const integration = { id: "bland", findInboundCall: async (_account: unknown, input: any) => {
    assert.equal(input.toNumber, "+14155550100");
    assert.equal(input.fromNumber, "+14155550101");
    return "inbound";
  }, getCall: async () => ({ details: { metadata: { side: "target" } }, events: [{ event_type: "node.transition" }],
    trace: [{ kind: "node", label: "greeting" }] }) };
  const context = { exports: {} as { POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> },
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "@/lib/store") return { getResult: () => saved, saveResult: (value: unknown) => { saved = value; },
        listAccounts: () => [{ id: "account1", provider: "bland" }],
        getAccountRaw: () => ({ id: "account1", provider: "bland" }) };
      if (name === "@hal/core") return { createLLM: () => ({}), getIntegration: () => integration,
        refreshHostedCall: async ({ result }: any) => ({ state: "completed", result: { ...result, status: "passed",
          providerCalls: { testingAgent: { externalCallId: "outbound" } }, trace: [] } }) };
      if (name === "@/lib/runRecordings") return { downloadRunRecording: () => {} };
      throw new Error(`Unexpected dependency: ${name}`);
    } };
  runInNewContext(compiled, context);
  const response = await context.exports.POST(new Request("http://localhost"), { params: Promise.resolve({ id: "run2" }) });
  assert.equal(response.status, 200);
  assert.equal(saved.providerCalls.targetAgent.externalCallId, "inbound");
  assert.equal(saved.trace[0].side, "targetAgent");
});

test("refresh looks up the receiving provider in its own saved account", async () => {
  let saved: any = { id: "run3", status: "running", externalCallId: "vapi-out", startedAt: 1000,
    transcript: [], context: { account: { id: "vapi-account", provider: "vapi" }, judge: { mode: "rules-only" },
      testingAgent: { provider: "vapi", direction: "outbound", phoneNumber: "+14155550101" },
      targetAgent: { provider: "retell", direction: "inbound", phoneNumber: "+14155550100", externalAgentId: "retell-agent" } } };
  const context = { exports: {} as { POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> },
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "@/lib/store") return { getResult: () => saved, saveResult: (value: unknown) => { saved = value; },
        listAccounts: () => [{ id: "vapi-account", provider: "vapi" }, { id: "retell-account", provider: "retell" }],
        getAccountRaw: (id: string) => ({ id, provider: id === "retell-account" ? "retell" : "vapi" }) };
      if (name === "@hal/core") return { createLLM: () => ({}), getIntegration: (provider: string) => provider === "retell"
        ? { id: "retell", findInboundCall: async (account: any, input: any) => {
          assert.equal(account.id, "retell-account"); assert.equal(input.externalAgentId, "retell-agent"); return "retell-in";
        }, getCall: async () => ({ details: { analysis: { success: true } }, trace: [] }) }
        : { id: "vapi" }, refreshHostedCall: async ({ result }: any) => ({ state: "completed", result: { ...result, status: "passed" } }) };
      if (name === "@/lib/runRecordings") return { downloadRunRecording: () => {} };
      throw new Error(`Unexpected dependency: ${name}`);
    } };
  runInNewContext(compiled, context);
  const response = await context.exports.POST(new Request("http://localhost"), { params: Promise.resolve({ id: "run3" }) });
  assert.equal(response.status, 200);
  assert.equal(saved.providerCalls.targetAgent.accountId, "retell-account");
  assert.equal(saved.providerCalls.targetAgent.details.analysis.success, true);
});
