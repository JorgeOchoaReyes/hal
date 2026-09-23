// Stage the built @hal/web standalone server into apps/desktop/resources/web so
// electron-builder can bundle a fully offline app. Run after `next build`
// (output: "standalone") in apps/web.
//
// Next's standalone output does NOT include the static assets, so we copy
// `.next/static` next to the server as the Next docs require.
import { cpSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "..");
const web = join(desktop, "..", "web");

const standalone = join(web, ".next", "standalone");
const staticDir = join(web, ".next", "static");
const dest = join(desktop, "resources", "web");

if (!existsSync(standalone)) {
  console.error(
    "[stage-web] apps/web/.next/standalone not found. Run `pnpm --filter @hal/web build` first (next.config has output: 'standalone').",
  );
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

// The whole standalone tree (server.js under apps/web, plus node_modules/packages).
// dereference: true turns pnpm's symlinked node_modules (e.g. node_modules/next ->
// ../../node_modules/.pnpm/...) into real file copies. Those symlinks resolve on
// macOS/Linux but break once packaged on Windows, so the bundled server crashes
// with "Cannot find module 'next'" (black screen). Copying real files fixes it
// on every platform.
cpSync(standalone, dest, { recursive: true, dereference: true });

// Static assets must sit at apps/web/.next/static beside the server.
const staticOut = join(dest, "apps", "web", ".next", "static");
if (existsSync(staticDir)) {
  mkdirSync(dirname(staticOut), { recursive: true });
  cpSync(staticDir, staticOut, { recursive: true, dereference: true });
}

// public/ if the app has one.
const pub = join(web, "public");
if (existsSync(pub)) {
  cpSync(pub, join(dest, "apps", "web", "public"), { recursive: true, dereference: true });
}

console.log(`[stage-web] staged offline web server -> ${dest}`);
