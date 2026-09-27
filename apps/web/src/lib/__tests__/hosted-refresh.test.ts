import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../../app/api/results/[id]/refresh/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test("a manual call check uses the saved account and updates the same run", async () => {
  let saved: any = {
    id: "run1", testCaseId: "tc1", status: "errored", externalCallId: "call1", transcript: [],
    context: { account: { id: "account1", provider: "bland" },
      targetAgent: { direction: "inbound" }, judge: { mode: "rules-only" } },
  };
  let checked = false;
  const context = { exports: {} as { POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> },
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "@/lib/store") return {
        getResult: () => saved, saveResult: (result: unknown) => { saved = result; },
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
