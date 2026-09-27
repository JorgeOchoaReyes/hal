import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { HostedTestingAgent } from "@hal/core";

function route(path: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(`../../app/api/${path}/route.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {} as { POST: (req: { json: () => Promise<unknown> }) => Promise<Response> }, require: (name: string) => {
    if (name === "next/server") return { NextResponse: Response };
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  } };
  runInNewContext(compiled, context);
  return (body: unknown) => context.exports.POST({ json: async () => body });
}

test("importing and editing existing testers is local, account-scoped, and duplicate-safe", async () => {
  for (const provider of ["bland", "vapi", "retell", "elevenlabs"]) {
    const agents = new Map<string, HostedTestingAgent>();
    let serial = 0;
    const post = route("testing-agents", {
      "@hal/core": {
        id: () => `agent${++serial}`,
        getIntegration: () => ({ createTestingAgent: () => { throw new Error("Import must never provision an agent"); } }),
      },
      "@/lib/store": {
        getAccountRaw: (id: string) => ["account1", "account2"].includes(id) ? { id, provider } : undefined,
        getAgent: (id: string) => agents.get(id), listAgents: () => [...agents.values()],
        upsertAgent: (agent: HostedTestingAgent) => agents.set(agent.id, agent),
        publicAgent: (agent: HostedTestingAgent) => ({ ...agent, encryptedKey: undefined, hasEncryptedKey: Boolean(agent.encryptedKey) }),
      },
    });
    const body = { importExisting: true, accountId: "account1", name: "My tester", externalAgentId: " remote1 ", encryptedKey: "secret" };
    const imported = await post(body);
    assert.equal(imported.status, 201);
    const data = await imported.json();
    assert.equal(data.agent.externalAgentId, "remote1");
    assert.equal(data.agent.imported, true);
    assert.equal(data.agent.encryptedKey, undefined);
    assert.equal(data.agent.spec?.pathwayId, provider === "bland" ? "remote1" : undefined);
    assert.equal((await post(body)).status, 409);
    assert.equal((await post({ ...body, accountId: "account2" })).status, 201);
    assert.equal((await post({ ...body, agentId: data.agent.id, accountId: "account2" })).status, 404);
    const edited = await post({ accountId: "account1", agentId: data.agent.id, name: "Renamed" });
    assert.equal(edited.status, 200);
    assert.equal(agents.get(data.agent.id)?.externalAgentId, "remote1");
    assert.equal(agents.get(data.agent.id)?.encryptedKey, "secret");
    assert.equal((await post({ ...body, externalAgentId: " " })).status, 400);
    assert.equal((await post({ ...body, externalAgentId: 42 })).status, 400);
  }
});

test("simulation dispatch reuses imported testers in both call directions", async () => {
  for (const outboundIsTarget of [false, true]) {
    const imported: HostedTestingAgent = {
      id: "tester", name: "Existing tester", accountId: "account1", provider: "bland", imported: true,
      externalAgentId: "existing-pathway", createdAt: 0,
      spec: { name: "Existing tester", persona: { name: "Tester", systemPrompt: "" }, pathwayId: "existing-pathway" },
    };
    let receivedAgent: HostedTestingAgent | undefined;
    let inboundPathway: string | undefined;
    const integration = {
      createTestingAgent: () => { throw new Error("Must not provision"); },
      buildFlowConfig: () => { throw new Error("Must not compile the saved script"); },
      configureInbound: async (_account: unknown, agent: HostedTestingAgent) => { inboundPathway = agent.externalAgentId; },
      placeOutboundCall: async () => ({ externalCallId: "call1" }),
    };
    const result = { id: "run1", status: "passed", transcript: [] };
    const post = route("run-hosted-sim", {
      "@hal/core": {
        getIntegration: () => integration, createLLM: () => ({}),
        runHostedCall: async (options: { agent: HostedTestingAgent }) => { receivedAgent = options.agent; return result; },
      },
      "@/lib/store": {
        getTestCase: () => ({ id: "tc1", name: "Simulation", scenario: { persona: {}, steps: [{ kind: "wait" }] }, judge: {} }),
        getAgent: () => imported,
        getTarget: () => ({ id: "target", provider: "bland", externalAgentId: "target-pathway" }),
        getAccountRaw: () => ({ id: "account1", provider: "bland", credentials: {} }),
        outboundAgentKey: () => undefined, saveResult: () => {}, getResult: () => result,
        upsertAgent: () => { throw new Error("Must not replace imported tester"); },
      },
      "@/lib/runContext": { snapshotRun: () => ({}), hostedContext: () => ({}) },
      "@/lib/runRecordings": {},
    });
    const tester = { kind: "testing", id: "tester" };
    const target = { kind: "target", id: "target" };
    const res = await post({ testCaseId: "tc1", accountId: "account1", phoneNumber: "+14155550123", configureInbound: outboundIsTarget, inboundAgent: outboundIsTarget ? tester : target, outboundAgent: outboundIsTarget ? target : tester });
    assert.equal(res.status, 200, await res.text());
    assert.equal(receivedAgent?.externalAgentId, "existing-pathway");
    assert.equal(receivedAgent?.spec, imported.spec);
    assert.equal(inboundPathway, outboundIsTarget ? "existing-pathway" : undefined);
  }
});
