import { contextBridge } from "electron";

/**
 * Minimal, locked-down bridge. HAL's UI is a normal web app, so it needs almost
 * nothing from the desktop shell — we just expose a marker so the web app can
 * tell it's running inside the desktop container if it ever wants to adapt.
 */
contextBridge.exposeInMainWorld("hal", {
  desktop: true,
  version: process.versions.electron,
});
