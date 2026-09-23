// Smoke test the staged offline server the packaged app boots.
//
// Runs `resources/web/apps/web/server.js` exactly as the Electron app does
// (plain Node, its own cwd, a temp data dir), waits for it to answer, and
// asserts it serves the dashboard. This catches bundle/resolution breakage
// (e.g. "Cannot find module 'next'" → black screen) on the CURRENT OS — so a
// Windows runner catches Windows-only symlink issues — cheaply in CI, before we
// spend a full multi-OS release build to discover it.
//
// Prerequisite: `pnpm --filter @hal/desktop stage:web` has produced resources/web.
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, "..", "resources", "web", "apps", "web");
const server = join(serverDir, "server.js");
const PORT = Number(process.env.SMOKE_PORT ?? 3987);

if (!existsSync(server)) {
  console.error(`[smoke] staged server not found at ${server}. Run stage:web first.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "hal-smoke-"));
const child = spawn(process.execPath, [server], {
  cwd: serverDir,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "production", HAL_DATA_DIR: dataDir },
  stdio: "inherit",
});

let done = false;
function finish(code, msg) {
  if (done) return;
  done = true;
  if (msg) console[code === 0 ? "log" : "error"](msg);
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  process.exit(code);
}

child.on("exit", (code) => finish(1, `[smoke] server exited early with code ${code}`));

const deadline = Date.now() + 45_000;
function attempt() {
  if (done) return;
  http
    .get(`http://localhost:${PORT}/`, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode === 200 && /Simulations|HAL/.test(body)) {
          finish(0, `[smoke] OK — server served the dashboard (HTTP ${res.statusCode}).`);
        } else if (Date.now() > deadline) {
          finish(1, `[smoke] served HTTP ${res.statusCode} but body didn't look like the app.`);
        } else {
          setTimeout(attempt, 800);
        }
      });
    })
    .on("error", () => {
      if (Date.now() > deadline) finish(1, "[smoke] server did not answer within 45s.");
      else setTimeout(attempt, 800);
    });
}
setTimeout(attempt, 1500);
