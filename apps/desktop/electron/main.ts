import { app, BrowserWindow, shell } from "electron";
import { spawn, ChildProcess } from "node:child_process";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import http from "node:http";
import { initUpdater } from "./updater.js";

/**
 * HAL desktop shell.
 *
 * In development it points at a running `@hal/web` dev server (HAL_WEB_URL).
 * In production it boots the Next.js standalone server bundled with the web app
 * and loads it locally, so the whole test lab runs offline on the user's machine.
 */

const DEV_URL = process.env.HAL_WEB_URL ?? "http://localhost:3000";
const PORT = Number(process.env.PORT ?? 3210);

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;

function resolveStandaloneServer(): string | null {
  // Staged by scripts/stage-web.mjs into resources/web (electron-builder
  // extraResources), or found in the monorepo during local packaging.
  const candidates = [
    join(process.resourcesPath ?? "", "web", "apps", "web", "server.js"),
    join(__dirname, "..", "resources", "web", "apps", "web", "server.js"),
    join(__dirname, "..", "..", "web", ".next", "standalone", "apps", "web", "server.js"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function waitForServer(url: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on("error", () => {
          if (Date.now() - start > timeoutMs) reject(new Error("server did not start"));
          else setTimeout(attempt, 400);
        });
    };
    attempt();
  });
}

async function resolveAppUrl(): Promise<string> {
  if (!app.isPackaged) return DEV_URL;

  const server = resolveStandaloneServer();
  if (!server) return DEV_URL;

  // Persist HAL's data (SQLite/JSON) in the OS user-data dir, which is writable
  // and durable — never inside the read-only app bundle.
  const dataDir = join(app.getPath("userData"), "data");

  serverProcess = spawn(process.execPath, [server], {
    // Run the bundled Electron binary as plain Node, not a second app window.
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(PORT),
      NODE_ENV: "production",
      HAL_DATA_DIR: dataDir,
    },
    // cwd = the server dir so Next resolves ./.next/static and ./public.
    cwd: dirname(server),
    stdio: "inherit",
  });
  const url = `http://localhost:${PORT}`;
  await waitForServer(url);
  return url;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0b0d10",
    title: "HAL — Voice AI Test Lab",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open external links in the user's browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const url = await resolveAppUrl();
  await mainWindow.loadURL(url);

  // Smoke mode: capture a screenshot after load and exit. Lets CI / a headless
  // run (xvfb) prove the app boots and renders the web UI.
  if (process.env.HAL_SCREENSHOT) {
    try {
      const image = await mainWindow.webContents.capturePage();
      await writeFile(process.env.HAL_SCREENSHOT, image.toPNG());
      // eslint-disable-next-line no-console
      console.log(`[hal-desktop] screenshot written to ${process.env.HAL_SCREENSHOT}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[hal-desktop] screenshot failed", err);
      app.exit(1);
      return;
    }
    app.quit();
    return;
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  // Register the update IPC + check on launch. In dev/unpackaged it makes no
  // network calls (reports "up to date"); real checks run only in packaged builds.
  initUpdater();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("quit", () => {
  serverProcess?.kill();
});
