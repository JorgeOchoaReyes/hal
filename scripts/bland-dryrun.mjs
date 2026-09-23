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
 *   PATHWAY=1                  also probe pathway creation (FREE — places no call)
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

/** Raw probe: show status + a snippet of the body so we can see the real shape.
 *  Returns the parsed JSON (or null) so callers can chain (e.g. pathway id). */
async function probe(method, path, body) {
  const url = `${BASE}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json = null;
    let pretty = text;
    try {
      json = JSON.parse(text);
      pretty = JSON.stringify(json, null, 2);
    } catch {
      /* not JSON */
    }
    console.log(`${method} ${path} → ${res.status} ${res.statusText}`);
    console.log(pretty.slice(0, 1200));
    console.log();
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    console.log(`${method} ${path} → ERROR ${(err && err.message) || err}`);
    console.log();
    return { ok: false, status: 0, json: null };
  }
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

  if (process.env.PATHWAY) {
    head("P) Pathway discovery — deterministic test agent (FREE, places no call)");
    const structured = {
      role: "You are a patient booking a dental appointment.",
      conditions: [
        { id: 0, condition: "FIRST_MESSAGE", action: "Hi, I'd like to book an appointment.", type: "standard", fixed_message: true },
        { id: 1, condition: "The agent asks which day", action: "Ask for the first available Tuesday", type: "standard", fixed_message: false },
        { id: 2, condition: 1, action: "Great, thanks! <endcall/>", type: "action_followup", fixed_message: true },
      ],
    };
    const graph = core.toBlandPathway(core.structuredToFlow(structured), "HAL dry-run pathway");
    console.log("Graph HAL builds (name/nodes/edges):");
    console.log(JSON.stringify(graph, null, 2).slice(0, 1500), "\n");

    console.log(">> Create-shell candidates:");
    const c1 = await probe("POST", "/v1/pathway/create", { name: graph.name, description: "HAL dry-run" });
    const c2 = c1.ok ? { json: null } : await probe("POST", "/v1/pathways", { name: graph.name, description: "HAL dry-run" });
    const idFrom = (r) => r && r.json && (r.json.pathway_id ?? r.json.id ?? r.json.data?.pathway_id ?? r.json.data?.id);
    const pid = idFrom(c1) ?? idFrom(c2);
    console.log("→ pathway id:", pid ?? "(none returned)", "\n");

    if (pid) {
      console.log(">> Set-graph candidates on the created pathway:");
      await probe("POST", `/v1/pathway/${pid}`, { name: graph.name, nodes: graph.nodes, edges: graph.edges });
      await probe("POST", `/v1/pathway/${pid}/version`, { name: graph.name, nodes: graph.nodes, edges: graph.edges });
    }

    console.log(">> HAL createTestingAgent() [structured] end-to-end:");
    try {
      const spec = { name: "HAL dry-run pathway", persona: { name: "Tester", systemPrompt: structured.role }, structured };
      const r = await bland.createTestingAgent(account, spec);
      console.log("   OK — externalAgentId (pathway id):", r.externalAgentId, "\n");
    } catch (err) {
      console.log("   FAILED:", (err && err.message) || err, "\n");
    }
  }

  if (!TARGET) {
    head("Done. Set TARGET_NUMBER=+1... to place a REAL paid test call (add PATHWAY=1 to call via the pathway).");
    return;
  }

  const usePathway = Boolean(process.env.PATHWAY);
  head(`4) createTestingAgent() [${usePathway ? "structured/pathway" : "prompt"} mode] — provisions a Bland agent`);
  const spec = usePathway
    ? {
        name: "HAL dry-run pathway",
        persona: { name: "Tester", systemPrompt: "You are a patient booking a dental appointment." },
        structured: {
          role: "You are a patient booking a dental appointment.",
          conditions: [
            { id: 0, condition: "FIRST_MESSAGE", action: "Hi, I'd like to book an appointment.", type: "standard", fixed_message: true },
            { id: 1, condition: "The agent asks which day", action: "Ask for the first available Tuesday", type: "standard", fixed_message: false },
            { id: 2, condition: 1, action: "Great, thanks! <endcall/>", type: "action_followup", fixed_message: true },
          ],
        },
      }
    : {
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
