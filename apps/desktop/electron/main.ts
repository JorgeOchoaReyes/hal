import { app, BrowserWindow, shell } from "electron";
import { spawn, ChildProcess } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "node:fs";
import http from "node:http";

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
  // electron-builder unpacks the web app's standalone output next to us.
  const candidates = [
    join(__dirname, "..", "..", "web", ".next", "standalone", "apps", "web", "server.js"),
    join(process.resourcesPath ?? "", "web", "server.js"),
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

  serverProcess = spawn(process.execPath, [server], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "production" },
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

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("quit", () => {
  serverProcess?.kill();
});
