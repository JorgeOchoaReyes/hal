import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const compile = (path: string) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test("linking the receiving call saves its independent metadata and tool events", async () => {
  let saved: any = { id: "run", status: "passed", trace: [{ side: "testingAgent", kind: "node", label: "first" }],
    providerCalls: { testingAgent: { externalCallId: "outbound" } },
    context: { testingAgent: { provider: "bland" }, targetAgent: { provider: "bland" } } };
  const context = { exports: {} as { POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> },
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "@/lib/store") return { getResult: () => saved, saveResult: (value: unknown) => { saved = value; },
        getAccountRaw: () => ({ id: "account", provider: "bland" }) };
      if (name === "@hal/core") return { getIntegration: () => ({ getCall: async () => ({ details: { metadata: { source: "receiver" } },
        events: [{ event_type: "tool.invoke" }], trace: [{ kind: "tool-call", label: "lookup" }] }) }) };
      throw new Error(`Unexpected dependency: ${name}`);
    } };
  runInNewContext(compile("../../app/api/results/[id]/provider-call/route.ts"), context);
  const response = await context.exports.POST(new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ side: "targetAgent", accountId: "account", externalCallId: "inbound" }) }), { params: Promise.resolve({ id: "run" }) });
  assert.equal(response.status, 200);
  assert.equal(saved.providerCalls.testingAgent.externalCallId, "outbound");
  assert.equal(saved.providerCalls.targetAgent.details.metadata.source, "receiver");
  assert.equal(saved.trace.length, 2);
  assert.equal(saved.trace[1].side, "targetAgent");
});
