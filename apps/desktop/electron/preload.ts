import { contextBridge, ipcRenderer } from "electron";

/**
 * Locked-down bridge from the desktop shell to HAL's web UI. The UI is a normal
 * web app, so it needs almost nothing — a marker that it's running inside the
 * desktop container, plus the auto-update API the Settings page uses.
 */
contextBridge.exposeInMainWorld("hal", {
  desktop: true,
  version: process.versions.electron,
  updates: {
    /** Current update state (version, status, latest, progress). */
    get: () => ipcRenderer.invoke("updates:get"),
    /** Trigger a check for updates now. */
    check: () => ipcRenderer.invoke("updates:check"),
    /** Quit and install a downloaded update (force sync to latest). */
    install: () => ipcRenderer.invoke("updates:install"),
    /** Subscribe to live status pushes; returns an unsubscribe function. */
    onStatus: (cb: (status: unknown) => void) => {
      const listener = (_e: unknown, status: unknown) => cb(status);
      ipcRenderer.on("updates:status", listener);
      return () => ipcRenderer.removeListener("updates:status", listener);
    },
  },
});
