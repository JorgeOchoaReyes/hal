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
    if (provider === "bland") {
      const molded = agents.get(data.agent.id)!;
      agents.set(data.agent.id, { ...molded, spec: { name: molded.name, persona: { name: "Everyday customer", systemPrompt: "Be busy" }, steps: [{ kind: "say", text: "Hello" }], pathwayId: "remote1" } });
      assert.equal((await post({ accountId: "account1", agentId: data.agent.id, name: "Edited again" })).status, 200);
      assert.equal(agents.get(data.agent.id)?.spec?.steps?.[0]?.kind, "say");
    }
    assert.equal((await post({ ...body, externalAgentId: " " })).status, 400);
    assert.equal((await post({ ...body, externalAgentId: 42 })).status, 400);
  }
});

test("simulation dispatch updates imported Bland tester's pathway in both call directions", async () => {
  for (const outboundIsTarget of [false, true]) {
    const imported: HostedTestingAgent = {
      id: "tester", name: "Existing tester", accountId: "account1", provider: "bland", imported: true,
      externalAgentId: "existing-pathway", createdAt: 0,
      spec: { name: "Existing tester", persona: { name: "Tester", systemPrompt: "" }, pathwayId: "existing-pathway" },
    };
    let receivedAgent: HostedTestingAgent | undefined;
    let inboundPathway: string | undefined;
    let updatedSpec: unknown;
    let savedAgent: HostedTestingAgent | undefined;
    const integration = {
      listAvailableVoices: async () => ["main-voice", "tester-voice"],
      createTestingAgent: () => { throw new Error("Must not provision"); },
      buildFlowConfig: () => ({}),
      updateTestingAgent: async (_account: unknown, agent: HostedTestingAgent, spec: unknown) => {
        assert.equal(agent.externalAgentId, "existing-pathway");
        updatedSpec = spec;
      },
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
        getTestCase: () => ({ id: "tc1", name: "Simulation", scenario: { persona: { name: "Everyday customer", systemPrompt: "You are a polite but busy customer calling a business. Answer questions directly." }, steps: [{ kind: "say", text: "Hi, I'd like some help please." }, { kind: "say", text: "Hey i need help sap" }, { kind: "say", text: "need to help now" }, { kind: "say", text: "hello?" }, { kind: "hangup" }] }, judge: {} }),
        getAgent: () => imported,
        getTarget: () => ({ id: "target", name: "Main", provider: "bland", externalAgentId: "target-pathway", voiceId: "main-voice" }),
        getAccountRaw: () => ({ id: "account1", provider: "bland", credentials: {} }),
        outboundAgentKey: () => undefined, saveResult: () => {}, getResult: () => result,
        upsertAgent: (agent: HostedTestingAgent) => { savedAgent = agent; },
      },
      "@/lib/runContext": { snapshotRun: () => ({}), hostedContext: () => ({}) },
      "@/lib/runRecordings": {},
    });
    const tester = { kind: "testing", id: "tester" };
    const target = { kind: "target", id: "target" };
    const res = await post({ testCaseId: "tc1", accountId: "account1", phoneNumber: "+14155550123", configureInbound: outboundIsTarget, inboundAgent: outboundIsTarget ? tester : target, outboundAgent: outboundIsTarget ? target : tester });
    assert.equal(res.status, 200, await res.text());
    assert.equal(receivedAgent?.externalAgentId, "existing-pathway");
    assert.equal(receivedAgent?.spec?.pathwayId, "existing-pathway");
    assert.equal(receivedAgent?.spec?.persona.systemPrompt, "You are a polite but busy customer calling a business. Answer questions directly.");
    assert.equal(receivedAgent?.spec?.voice, "tester-voice");
    assert.deepEqual(receivedAgent?.spec?.steps?.map((step) => step.kind === "say" ? step.text : step.kind), ["Hi, I'd like some help please.", "Hey i need help sap", "need to help now", "hello?", "hangup"]);
    assert.ok(updatedSpec);
    assert.equal(savedAgent?.id, imported.id);
    assert.equal(savedAgent?.imported, true);
    assert.equal(savedAgent?.spec?.persona.name, "Everyday customer");
    assert.equal(savedAgent?.spec?.steps?.length, 5);
    assert.equal(inboundPathway, outboundIsTarget ? "existing-pathway" : undefined);
  }
});

test("simulation dispatch uses a selected saved tester's pathway instead of provisioning another", async () => {
  const selected: HostedTestingAgent = {
    id: "selected", name: "HAL tester", accountId: "account1", provider: "bland",
    externalAgentId: "expected-pathway", createdAt: 0,
    spec: { name: "HAL tester", persona: { name: "Tester", systemPrompt: "saved" }, pathwayId: "expected-pathway" },
  };
  let received: HostedTestingAgent | undefined;
  const post = route("run-hosted-sim", {
    "@hal/core": {
      getIntegration: () => ({
        createTestingAgent: () => { throw new Error("Selected tester must not be provisioned again"); },
        buildFlowConfig: () => ({}),
        listAvailableVoices: async () => ["main-voice", "tester-voice"],
        updateTestingAgent: async () => {},
      }),
      createLLM: () => ({}),
      runHostedCall: async (options: { agent: HostedTestingAgent }) => {
        received = options.agent;
        return { id: "run1", status: "passed", transcript: [], externalCallId: "call1" };
      },
    },
    "@/lib/store": {
      getTestCase: () => ({ id: "tc1", name: "Scenario", scenario: { persona: { name: "Scenario", systemPrompt: "new" } }, judge: {} }),
      getAgent: () => selected,
      getTarget: () => ({ id: "target", name: "Main", provider: "bland", externalAgentId: "target-pathway", voiceId: "main-voice" }),
      getAccountRaw: () => ({ id: "account1", provider: "bland", credentials: {} }),
      outboundAgentKey: () => undefined, saveResult: () => {}, getResult: () => ({ id: "run1" }),
      upsertAgent: () => {},
    },
    "@/lib/runContext": { snapshotRun: () => ({}), hostedContext: () => ({}) },
    "@/lib/runRecordings": {},
  });
  const response = await post({ testCaseId: "tc1", accountId: "account1", phoneNumber: "+14155550123",
    inboundAgent: { kind: "target", id: "target" }, outboundAgent: { kind: "testing", id: "selected" } });
  assert.equal(response.status, 200, await response.text());
  assert.equal(received?.externalAgentId, "expected-pathway");
  assert.equal(received?.spec?.voice, "tester-voice");
});

test("dispatch molds and persists a selected tester for every hosted provider before calling", async () => {
  for (const provider of ["vapi", "retell", "elevenlabs"]) {
    const selected: HostedTestingAgent = { id: "tester", name: "HAL tester", accountId: "account1", provider,
      externalAgentId: "old-resource", imported: true, createdAt: 0 };
    const order: string[] = [];
    let saved: HostedTestingAgent | undefined;
    let called: HostedTestingAgent | undefined;
    const post = route("run-hosted-sim", {
      "@hal/core": {
        getIntegration: () => ({
          buildFlowConfig: () => ({}),
          listAvailableVoices: async () => ["main-voice", "tester-voice"],
          createTestingAgent: () => { throw new Error("Selected tester must be reused"); },
          updateTestingAgent: async (_account: unknown, agent: HostedTestingAgent, spec: { steps: Array<{ text?: string }> }) => {
            order.push("update");
            assert.equal(agent.id, "tester");
            assert.equal(spec.steps[0]!.text, "Hi, I'd like some help please.");
            return provider === "vapi" ? { externalAgentId: "new-squad" } : undefined;
          },
        }),
        createLLM: () => ({}),
        runHostedCall: async (options: { agent: HostedTestingAgent }) => { order.push("call"); called = options.agent; return { id: "run1", status: "passed", transcript: [] }; },
      },
      "@/lib/store": {
        getTestCase: () => ({ id: "tc1", name: "Scenario", scenario: { persona: { name: "Everyday customer", systemPrompt: "Be polite but busy" }, steps: [{ kind: "say", text: "Hi, I'd like some help please." }, { kind: "hangup" }] }, judge: {} }),
        getAgent: () => selected, getTarget: () => ({ id: "target", name: "Main", provider, voiceId: "main-voice" }),
        getAccountRaw: () => ({ id: "account1", provider, credentials: {} }),
        outboundAgentKey: () => undefined, saveResult: () => {}, getResult: () => ({ id: "run1" }),
        upsertAgent: (agent: HostedTestingAgent) => { order.push("save"); saved = agent; },
      },
      "@/lib/runContext": { snapshotRun: () => ({}), hostedContext: () => ({}) },
      "@/lib/runRecordings": {},
    });
    const response = await post({ testCaseId: "tc1", accountId: "account1", phoneNumber: "+14155550123",
      inboundAgent: { kind: "target", id: "target" }, outboundAgent: { kind: "testing", id: "tester" } });
    assert.equal(response.status, 200, await response.text());
    assert.deepEqual(order, ["update", "save", "call"]);
    assert.equal(saved?.externalAgentId, provider === "vapi" ? "new-squad" : "old-resource");
    assert.equal(called?.externalAgentId, saved?.externalAgentId);
    assert.equal(saved?.spec?.persona.name, "Everyday customer");
    assert.equal(saved?.spec?.voice, "tester-voice");
    assert.equal(saved?.spec?.graphKind, provider === "vapi" ? "squad" : undefined);
  }
});
