#!/usr/bin/env node
/**
 * Bland dry-run harness — exercise HAL's real Bland integration against the live
 * Bland API so we can confirm the exact endpoint/field shapes before running a
 * full simulation through the UI.
 *
 * Usage:
 *   pnpm --filter @hal/core build          # make sure packages/core/dist exists
 *   BLAND_API_KEY=sk_... node scripts/bland-dryrun.mjs
 *
 * Optional env:
 *   BLAND_FROM=+1XXXXXXXXXX    outbound caller id (a Bland number you own)
 *   TARGET_NUMBER=+1XXXXXXXXXX PLACE A REAL (paid) CALL to this number and poll it
 *   BLAND_BASE=https://api.bland.ai
 *
 * Safe by default: with no TARGET_NUMBER it only does READ-ONLY probes
 * (credential check, list numbers, and raw shape probes of the endpoints HAL
 * uses). It never places a paid call unless you set TARGET_NUMBER.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const distIndex = join(here, "..", "packages", "core", "dist", "index.js");

const KEY = process.env.BLAND_API_KEY;
const BASE = (process.env.BLAND_BASE ?? "https://api.bland.ai").replace(/\/$/, "");
const FROM = process.env.BLAND_FROM || undefined;
const TARGET = process.env.TARGET_NUMBER || undefined;

function line() {
  console.log("─".repeat(72));
}
function head(t) {
  line();
  console.log(t);
  line();
}

if (!KEY) {
  console.error("Set BLAND_API_KEY to run this. See the header of this file for usage.");
  process.exit(1);
}
if (!existsSync(distIndex)) {
  console.error(`@hal/core is not built at ${distIndex}.\nRun: pnpm --filter @hal/core build`);
  process.exit(1);
}

const headers = { authorization: KEY, "content-type": "application/json" };

/** Raw probe: show status + a snippet of the body so we can see the real shape. */
async function probe(method, path, body) {
  const url = `${BASE}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let pretty = text;
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* not JSON */
    }
    console.log(`${method} ${path} → ${res.status} ${res.statusText}`);
    console.log(pretty.slice(0, 1200));
  } catch (err) {
    console.log(`${method} ${path} → ERROR ${(err && err.message) || err}`);
  }
  console.log();
}

async function main() {
  const core = await import(distIndex);
  const bland = new core.BlandIntegration();
  const account = { id: "dryrun", provider: "bland", label: "dryrun", credentials: { apiKey: KEY, ...(FROM ? { from: FROM } : {}) }, createdAt: Date.now() };

  head("1) HAL verifyCredentials() — should say ok:true for a valid key");
  console.log(JSON.stringify(await bland.verifyCredentials(account), null, 2), "\n");

  head("2) Raw endpoint shape probes (which endpoints exist + their JSON shape)");
  await probe("GET", "/v1/me");
  await probe("GET", "/v1/inbound");
  await probe("GET", "/v1/numbers");

  head("3) HAL listNumbers() — the number picker source");
  try {
    console.log(JSON.stringify(await bland.listNumbers(account), null, 2), "\n");
  } catch (err) {
    console.log("listNumbers threw:", (err && err.message) || err, "\n");
  }

  if (!TARGET) {
    head("Done (read-only). Set TARGET_NUMBER=+1... to place a REAL paid test call.");
    return;
  }

  head("4) createTestingAgent() [prompt mode] — provisions a Bland agent");
  const spec = {
    name: "HAL dry-run tester",
    persona: { name: "Tester", systemPrompt: "You are a QA tester calling a business to book an appointment. Be brief." },
    firstMessage: "Hi, I'd like to book an appointment.",
  };
  const { externalAgentId } = await bland.createTestingAgent(account, spec);
  console.log("externalAgentId:", externalAgentId, "\n");

  head(`5) placeCall() → ${TARGET}  (this dials a real number)`);
  const agent = { id: "a", accountId: account.id, provider: "bland", externalAgentId, name: spec.name, createdAt: Date.now(), spec };
  const { externalCallId } = await bland.placeCall(account, agent, { phoneNumber: TARGET });
  console.log("externalCallId:", externalCallId, "\n");

  head("6) poll getCall() until ended (up to 2 min) — watch status + transcript roles");
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const state = await bland.getCall(account, externalCallId);
    const roles = (state.transcript ?? []).map((u) => u.role).join(",");
    console.log(`  status=${state.status}  turns=${state.transcript?.length ?? 0}  roles=[${roles}]`);
    if (state.status === "ended" || state.status === "failed") {
      console.log("\nfinal transcript:");
      console.log(JSON.stringify(state.transcript, null, 2));
      break;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }

  head("7) Raw GET /v1/calls/{id} — the ground-truth shape HAL parses");
  await probe("GET", `/v1/calls/${externalCallId}`);
}

main().catch((err) => {
  console.error("dry-run failed:", err);
  process.exit(1);
});
