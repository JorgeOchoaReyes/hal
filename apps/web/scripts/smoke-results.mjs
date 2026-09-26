// Exercise the embedded production server with isolated fixtures and no provider calls.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const staged = resolve(here, "../../desktop/resources/web/apps/web/server.js");
const server = existsSync(staged) ? staged : resolve(here, "../.next/standalone/apps/web/server.js");
const data = await mkdtemp(join(tmpdir(), "hal-results-smoke-"));
const port = 3991;
const env = { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", NODE_ENV: "production", HAL_DATA_DIR: data, HAL_DB: "json", HAL_MEDIA_GATEWAY: "off" };
for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "DEEPGRAM_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]) delete env[key];
const judge = { id: "j1", name: "Booking checker", kind: "code", createdAt: 0, spec: { mode: "rules-only", rules: [{ kind: "regex", role: "target", pattern: "booked" }] } };
const originalVerdict = { passed: true, score: 1, summary: "Original verdict", checks: [] };
const fixture = { id: "run1", testCaseId: "tc1", status: "passed", startedAt: 0, endedAt: 1000, transcript: [{ role: "target", text: "Your appointment is booked.", startedAt: 1 }], liveChecks: [], verdict: originalVerdict,
  recording: { status: "available", contentType: "audio/wav", bytes: 76, downloadedAt: 1 },
  context: { simulationName: "Historical simulation", transport: "bland", testingAgent: { name: "Historical tester", provider: "bland", pathwayId: "tester-pathway-fixture", pathwaySource: "dispatch", executionMode: "pathway", configuration: { steps: [{ kind: "say", text: "Hi" }, { kind: "hangup" }] } }, targetAgent: { name: "Historical target", provider: "bland", pathwayId: "inbound-pathway-fixture", pathwaySource: "inbound-number" }, judge: judge.spec, judges: [judge] } };
const tc = { id: "tc1", name: "Current simulation", target: { name: "Mock target", transport: "mock", mock: { systemPrompt: "Say hello", greeting: "Hello" } }, scenario: { id: "s1", name: "Test", persona: { name: "New tester", systemPrompt: "Say hello" }, steps: [{ kind: "say", text: "Hello" }], maxTurns: 2 }, judge: { mode: "rules-only", rules: [{ kind: "min-turns", count: 1 }] } };
await writeFile(join(data, "results.json"), JSON.stringify([fixture]));
await writeFile(join(data, "judges.json"), JSON.stringify([judge]));
await writeFile(join(data, "testcases.json"), JSON.stringify([tc, { ...tc, id: "tc-unsupported", scenario: { ...tc.scenario, steps: [{ kind: "wait", timeoutMs: 1000 }] } }]));
await writeFile(join(data, "targets.json"), JSON.stringify([{ id: "t1", name: "Target", provider: "bland", target: tc.target }]));
await mkdir(join(data, "recordings"));
// Valid mono PCM WAV: one short silent clip.
const wav = Buffer.alloc(76); wav.write("RIFF"); wav.writeUInt32LE(68, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(32, 40);
await writeFile(join(data, "recordings", createHash("sha256").update("run1").digest("hex") + ".audio"), wav);
let child = spawn(process.execPath, [server], { cwd: dirname(server), env, stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
child.stdout.on("data", (d) => logs += d); child.stderr.on("data", (d) => logs += d);
const base = `http://127.0.0.1:${port}`;
try {
  const deadline = Date.now() + 30_000;
  while (true) {
    try { if ((await fetch(base + "/api/results")).ok) break; } catch {}
    if (Date.now() > deadline || child.exitCode !== null) throw new Error("Embedded server failed to start: " + logs);
    await new Promise((r) => setTimeout(r, 100));
  }
  // Saved BYOT keys must survive restarts without exposing their values.
  const post = (path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const account = await (await post("/api/provider-accounts", { provider: "bland", label: "Saved key test", credentials: { apiKey: "fixture-api" } })).json();
  const account2 = await (await post("/api/provider-accounts", { provider: "bland", label: "Other account", credentials: { apiKey: "fixture-api2" } })).json();
  const secret = "fixture-byot-secret";
  const saved = await post("/api/byot-keys", { accountId: account.account.id, name: "Main Twilio", encryptedKey: secret });
  assert.equal(saved.status, 201);
  const savedText = await saved.text(); assert(!savedText.includes(secret));
  const key = JSON.parse(savedText).key;
  const onDisk = await readFile(join(data, "byotkeys.json"), "utf8");
  assert(!onDisk.includes(secret)); assert(onDisk.includes("enc:v1:"));
  assert.equal((await post("/api/byot-keys", { accountId: account.account.id, name: "Main Twilio", encryptedKey: secret })).status, 409);
  assert.deepEqual((await (await fetch(base + `/api/byot-keys?accountId=${account2.account.id}`)).json()).keys, []);
  assert.equal((await fetch(base + `/api/byot-keys?accountId=${account2.account.id}&id=${key.id}`, { method: "DELETE" })).status, 404);
  // Importing an existing pathway does not call the provider; exercise agent editing locally.
  const imported = await post("/api/testing-agents", { accountId: account.account.id, name: "Editable tester", systemPrompt: "Tester", pathwayId: "fixture-pathway", encryptedKey: secret });
  assert.equal(imported.status, 201);
  const importedText = await imported.text(); assert(!importedText.includes(secret));
  const agent = JSON.parse(importedText).agent;
  assert.equal(agent.hasEncryptedKey, true);
  assert(!(await readFile(join(data, "agents.json"), "utf8")).includes(secret));
  const edited = await post("/api/testing-agents", { agentId: agent.id, accountId: account.account.id, name: "Renamed tester", systemPrompt: "Tester", pathwayId: "fixture-pathway", byotKeyId: key.id, encryptedKey: "" });
  assert.equal(edited.status, 200); assert.equal((await edited.json()).agent.id, agent.id);
  const patchTarget = await fetch(base + "/api/targets/t1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Editable main agent", encryptedKey: secret, byotKeyId: key.id, byotAccountId: account.account.id, externalAgentId: "fixture-target-pathway" }) });
  assert.equal(patchTarget.status, 200); assert(!(await patchTarget.text()).includes(secret));
  assert(!(await readFile(join(data, "targets.json"), "utf8")).includes(secret));
  const editedScenario = { ...tc.scenario, steps: [{ kind: "say", text: "Updated script" }, { kind: "hangup" }] };
  const patchScenario = (body) => fetch(base + "/api/testcases/tc1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await patchScenario({ scenario: editedScenario, expectedScenario: tc.scenario })).status, 200);
  assert.equal((await patchScenario({ scenario: tc.scenario, expectedScenario: tc.scenario })).status, 409);
  assert.equal((await patchScenario({ scenario: { ...editedScenario, steps: [{ kind: "say", text: "" }] } })).status, 400);
  const storedCase = JSON.parse(await readFile(join(data, "testcases.json"), "utf8")).find((r) => r.id === "tc1");
  assert.deepEqual(storedCase.judge, tc.judge); assert.deepEqual(storedCase.target, tc.target);
  assert.equal(storedCase.scenario.steps[0].text, "Updated script");
  const simulationHtml = await (await fetch(base + "/simulations/tc1")).text();
  for (const text of ["Edit scenario", "Updated script", "Bland chat"]) assert(simulationHtml.includes(text), text);
  assert.equal((await post("/api/run-bland-chat", { testCaseId: "tc1", accountId: "missing", pathwayId: "fixture" })).status, 400);
  assert.equal((await post("/api/run-bland-chat", { testCaseId: "tc1", accountId: account.account.id })).status, 400);
  child.kill(); await once(child, "exit");
  child = spawn(process.execPath, [server], { cwd: dirname(server), env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => logs += d); child.stderr.on("data", (d) => logs += d);
  const restartDeadline = Date.now() + 30_000;
  while (true) {
    try { if ((await fetch(base + "/api/results")).ok) break; } catch {}
    if (Date.now() > restartDeadline || child.exitCode !== null) throw new Error("Restart failed: " + logs);
    await new Promise((r) => setTimeout(r, 100));
  }
  const afterRestart = await (await fetch(base + `/api/byot-keys?accountId=${account.account.id}`)).text();
  assert(!afterRestart.includes(secret)); assert.equal(JSON.parse(afterRestart).keys[0].id, key.id);
  const dispatch = { testCaseId: "tc-unsupported", accountId: account.account.id, phoneNumber: "+14155550123", byotKeyId: key.id, inboundAgent: { kind: "target", id: "t1" }, outboundAgent: { kind: "testing", id: "" } };
  const validKey = await post("/api/run-hosted-sim", dispatch);
  assert.equal(validKey.status, 400); assert.match((await validKey.json()).error, /cannot be reproduced exactly/);
  const wrongAccount = await post("/api/run-hosted-sim", { ...dispatch, accountId: account2.account.id });
  assert.equal(wrongAccount.status, 400); assert.match((await wrongAccount.json()).error, /Saved BYOT key not found/);
  assert.equal((await fetch(base + `/api/byot-keys?accountId=${account.account.id}&id=${key.id}`, { method: "DELETE" })).status, 200);
  assert.deepEqual((await (await fetch(base + `/api/byot-keys?accountId=${account.account.id}`)).json()).keys, []);
  const ignoredInboundKey = await post("/api/run-hosted-sim", { ...dispatch, byotKeyId: undefined });
  assert.equal(ignoredInboundKey.status, 400); assert.match((await ignoredInboundKey.json()).error, /cannot be reproduced exactly/);
  const missingOutboundKey = await post("/api/run-hosted", { agentId: agent.id, phoneNumber: "+14155550123" });
  assert.equal(missingOutboundKey.status, 400); assert.match((await missingOutboundKey.json()).error, /saved BYOT key was removed/);
  const pool = await post("/api/run-hosted-sim", { ...dispatch, byotKeyId: undefined, fromNumber: "", outboundAgent: { kind: "testing", id: agent.id } });
  assert.equal(pool.status, 400); assert.match((await pool.json()).error, /cannot be reproduced exactly/);
  const reversed = await post("/api/run-hosted-sim", { ...dispatch, byotKeyId: undefined, inboundAgent: { kind: "testing", id: "" }, outboundAgent: { kind: "target", id: "t1" }, configureInbound: true });
  assert.equal(reversed.status, 400); assert.match((await reversed.json()).error, /saved BYOT key was removed/);
  const agentList = await (await fetch(base + "/api/testing-agents")).text(); assert(!agentList.includes(secret)); assert(agentList.includes("Renamed tester"));
  console.log("PASS: editable scenarios and agents persist, secrets are redacted, only the outbound caller key is required, and Bland chat validates inputs");
  console.log("PASS: saved BYOT keys are encrypted, redacted, account-scoped, persistent across restart, and removable");
  const html = await (await fetch(base + "/results/run1")).text();
  for (const value of ["Historical tester", "Historical target", "tester-pathway-fixture", "inbound-pathway-fixture", "Bland pathway ID", "Booking checker", "Original verdict", "Apply additional judges", "/api/results/run1/recording"]) assert(html.includes(value), value);
  assert.equal((await fetch(base + "/results/missing")).status, 404);
  const range = await fetch(base + "/api/results/run1/recording", { headers: { range: "bytes=0-3" } });
  assert.equal(range.status, 206); assert.equal(range.headers.get("content-range"), "bytes 0-3/76"); assert.equal(await range.text(), "RIFF");
  assert.equal((await fetch(base + "/api/results/run1/recording", { headers: { range: "bytes=999-" } })).status, 416);
  const score = await fetch(base + "/api/results/run1/score", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ judgeIds: ["j1"] }) });
  assert.equal(score.status, 200); assert.equal((await score.json()).evaluations[0].verdict.passed, true);
  const rejected = await fetch(base + "/api/results/run1/score", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ judgeIds: ["missing"] }) });
  assert.equal(rejected.status, 400);
  await fetch(base + "/api/judges/j1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Changed later", spec: { rules: [] } }) });
  const persisted = JSON.parse(await readFile(join(data, "results.json"), "utf8"))[0];
  assert.deepEqual(persisted.verdict, originalVerdict); assert.equal(persisted.evaluations.length, 1); assert.equal(persisted.evaluations[0].judge.name, "Booking checker"); assert.equal(persisted.evaluations[0].judge.spec.rules.length, 1); assert.equal(persisted.recording.status, "available");
  await fetch(base + "/api/run?testCaseId=tc1").then((r) => r.text());
  const runs = JSON.parse(await readFile(join(data, "results.json"), "utf8"));
  assert.equal(runs.length, 2); assert.equal(runs[1].context.testingAgent.name, "New tester"); assert.equal(runs[1].context.simulationName, "Current simulation");
  console.log("PASS: embedded run details, local audio range playback, saved judge evaluation, immutable original verdict, new-run snapshots, and missing-run handling");
} finally {
  if (child.exitCode === null) { child.kill(); await once(child, "exit"); }
  await rm(data, { recursive: true, force: true });
}
