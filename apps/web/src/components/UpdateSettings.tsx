"use client";

import { useEffect, useState, useCallback } from "react";

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "up-to-date"
  | "error";

interface UpdateState {
  supported: boolean;
  currentVersion: string;
  status: UpdateStatus;
  latestVersion?: string;
  percent?: number;
  error?: string;
  checkedAt?: number;
}

interface HalBridge {
  desktop?: boolean;
  version?: string;
  updates?: {
    get: () => Promise<UpdateState>;
    check: () => Promise<UpdateState>;
    install: () => Promise<UpdateState>;
    onStatus: (cb: (s: UpdateState) => void) => () => void;
  };
}

declare global {
  interface Window {
    hal?: HalBridge;
  }
}

const LABEL: Record<UpdateStatus, string> = {
  idle: "Idle",
  checking: "Checking…",
  available: "Update available",
  downloading: "Downloading…",
  downloaded: "Update ready",
  "up-to-date": "Up to date",
  error: "Error",
};
const TONE: Record<UpdateStatus, string> = {
  idle: "neutral",
  checking: "info",
  available: "warn",
  downloading: "info",
  downloaded: "warn",
  "up-to-date": "pass",
  error: "fail",
};

export default function UpdateSettings() {
  const [bridge, setBridge] = useState<HalBridge["updates"] | null>(null);
  const [inDesktop, setInDesktop] = useState<boolean | null>(null);
  const [state, setState] = useState<UpdateState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const hal = typeof window !== "undefined" ? window.hal : undefined;
    setInDesktop(Boolean(hal?.desktop));
    if (!hal?.updates) return;
    setBridge(hal.updates);
    hal.updates.get().then(setState).catch(() => undefined);
    const off = hal.updates.onStatus(setState);
    return off;
  }, []);

  const check = useCallback(async () => {
    if (!bridge) return;
    setBusy(true);
    try {
      setState(await bridge.check());
    } finally {
      setBusy(false);
    }
  }, [bridge]);

  const install = useCallback(async () => {
    if (bridge) await bridge.install();
  }, [bridge]);

  // Browser (not the desktop app): updates aren't applicable.
  if (inDesktop === false) {
    return (
      <div className="card">
        <strong>App updates</strong>
        <p className="muted" style={{ marginBottom: 0 }}>
          You&apos;re viewing HAL in a browser. Auto-updates apply to the{" "}
          <strong>desktop app</strong> — download it from the project&apos;s{" "}
          <a href="https://github.com/JorgeOchoaReyes/hal/releases" target="_blank" rel="noreferrer">
            Releases
          </a>{" "}
          page.
        </p>
      </div>
    );
  }

  const s = state;
  const isLatest = s?.status === "up-to-date";

  return (
    <div className="card">
      <div className="card-row">
        <strong>App updates</strong>
        {s && <span className={`label label-${TONE[s.status]}`}>{LABEL[s.status]}</span>}
      </div>

      <div className="metric-tiles" style={{ marginTop: 12 }}>
        <div className="metric-tile">
          <div className="metric-value" style={{ fontSize: 18 }}>v{s?.currentVersion ?? "—"}</div>
          <div className="metric-key">Installed version</div>
        </div>
        <div className="metric-tile">
          <div className="metric-value" style={{ fontSize: 18 }}>
            {s?.latestVersion ? `v${s.latestVersion}` : "—"}
          </div>
          <div className="metric-key">Latest available</div>
        </div>
        <div className="metric-tile">
          <div
            className="metric-value"
            style={{ fontSize: 18, color: !s ? "var(--muted)" : isLatest ? "var(--pass)" : "var(--warn)" }}
          >
            {!s ? "…" : isLatest ? "In sync" : s.status === "downloaded" ? "Ready" : "Out of sync"}
          </div>
          <div className="metric-key">Sync status</div>
        </div>
      </div>

      {s?.status === "downloading" && (
        <div className="score-bar" style={{ marginTop: 12 }}>
          <span style={{ width: `${s.percent ?? 0}%` }} />
        </div>
      )}
      {s?.status === "error" && (
        <p className="muted" style={{ color: "var(--fail)", marginTop: 10 }}>{s.error}</p>
      )}
      {!s?.supported && (
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Auto-update runs in a packaged, signed build. In a dev run it reports “up to date”.
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={check} disabled={busy || !bridge || s?.status === "checking"}>
          {busy || s?.status === "checking" ? "Checking…" : "Check for updates"}
        </button>
        <button
          className="secondary"
          onClick={install}
          disabled={s?.status !== "downloaded"}
          title={s?.status === "downloaded" ? "Restart and install the update" : "No update downloaded yet"}
        >
          Force sync &amp; restart
        </button>
      </div>
    </div>
  );
}
