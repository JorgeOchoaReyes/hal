import { app, BrowserWindow, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";

/**
 * OTA auto-updates for the HAL desktop app, backed by electron-updater and
 * GitHub Releases. The renderer (the web UI's Settings page) reads status and
 * triggers a check / install through the `hal.updates` preload bridge.
 *
 * Auto-update only works in a packaged, code-signed build (macOS requires
 * signing + notarization). In dev / unsigned runs `supported` is false and the
 * UI degrades to "managed by the desktop app".
 */
export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "up-to-date"
  | "error";

export interface UpdateState {
  supported: boolean;
  currentVersion: string;
  status: UpdateStatus;
  latestVersion?: string;
  percent?: number;
  error?: string;
  checkedAt?: number;
}

let state: UpdateState = { supported: false, currentVersion: "0.0.0", status: "idle" };

function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send("updates:status", state);
}
function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  broadcast();
}

export function initUpdater(): void {
  state = { supported: app.isPackaged, currentVersion: app.getVersion(), status: "idle" };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => set({ status: "checking" }));
  autoUpdater.on("update-available", (info) => set({ status: "available", latestVersion: info.version }));
  autoUpdater.on("update-not-available", (info) =>
    set({ status: "up-to-date", latestVersion: info.version, checkedAt: Date.now() }),
  );
  autoUpdater.on("download-progress", (p) => set({ status: "downloading", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => set({ status: "downloaded", latestVersion: info.version }));
  autoUpdater.on("error", (err) => set({ status: "error", error: String(err?.message ?? err) }));

  ipcMain.handle("updates:get", () => state);
  ipcMain.handle("updates:check", async () => {
    if (!state.supported) {
      set({ status: "up-to-date", checkedAt: Date.now() });
      return state;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      set({ status: "error", error: (e as Error).message });
    }
    return state;
  });
  ipcMain.handle("updates:install", () => {
    if (state.status === "downloaded") autoUpdater.quitAndInstall();
    return state;
  });

  // Check on launch (packaged builds only).
  if (state.supported) {
    autoUpdater.checkForUpdates().catch((e) => set({ status: "error", error: (e as Error).message }));
  } else {
    set({ status: "up-to-date", checkedAt: Date.now() });
  }
}
