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
  context: { simulationName: "Historical simulation", transport: "bland", testingAgent: { name: "Historical tester" }, targetAgent: { name: "Historical target" }, judge: judge.spec, judges: [judge] } };
const tc = { id: "tc1", name: "Current simulation", target: { name: "Mock target", transport: "mock", mock: { systemPrompt: "Say hello", greeting: "Hello" } }, scenario: { id: "s1", name: "Test", persona: { name: "New tester", systemPrompt: "Say hello" }, steps: [{ kind: "say", text: "Hello" }], maxTurns: 2 }, judge: { mode: "rules-only", rules: [{ kind: "min-turns", count: 1 }] } };
await writeFile(join(data, "results.json"), JSON.stringify([fixture]));
await writeFile(join(data, "judges.json"), JSON.stringify([judge]));
await writeFile(join(data, "testcases.json"), JSON.stringify([tc]));
await mkdir(join(data, "recordings"));
// Valid mono PCM WAV: one short silent clip.
const wav = Buffer.alloc(76); wav.write("RIFF"); wav.writeUInt32LE(68, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(32, 40);
await writeFile(join(data, "recordings", createHash("sha256").update("run1").digest("hex") + ".audio"), wav);
const child = spawn(process.execPath, [server], { cwd: dirname(server), env, stdio: ["ignore", "pipe", "pipe"] });
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
  const html = await (await fetch(base + "/results/run1")).text();
  for (const value of ["Historical tester", "Historical target", "Booking checker", "Original verdict", "Apply additional judges", "/api/results/run1/recording"]) assert(html.includes(value), value);
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
