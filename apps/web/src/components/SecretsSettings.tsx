"use client";

import { useEffect, useState } from "react";

type Source = "env" | "stored" | "none";
interface SecretStatus {
  key: string;
  set: boolean;
  source: Source;
}

interface Meta {
  key: string;
  label: string;
  group: string;
  help: string;
  secret?: boolean; // password field (default true)
  restart?: boolean; // needs an app restart to take effect
}

const META: Meta[] = [
  { key: "OPENAI_API_KEY", label: "OpenAI API key", group: "LLM (judge & simulated caller)", help: "Used by the LLM judge and the simulated caller when the provider is OpenAI or auto." },
  { key: "ANTHROPIC_API_KEY", label: "Anthropic API key", group: "LLM (judge & simulated caller)", help: "Used for Claude-based judging / simulation." },
  { key: "DEEPGRAM_API_KEY", label: "Deepgram API key", group: "Media gateway (WebRTC / SIP speech)", help: "Speech for the live WebRTC/SIP media gateway. (Transcription of uploaded calls has its own setting above.)", restart: true },
  { key: "TWILIO_ACCOUNT_SID", label: "Twilio Account SID", group: "Telephony (real PSTN calls)", help: "Twilio account for placing real phone calls.", restart: true },
  { key: "TWILIO_AUTH_TOKEN", label: "Twilio Auth Token", group: "Telephony (real PSTN calls)", help: "Twilio auth token.", restart: true },
  { key: "TWILIO_FROM_NUMBER", label: "Twilio From Number", group: "Telephony (real PSTN calls)", help: "The Twilio number calls are placed from (E.164).", secret: false, restart: true },
  { key: "HAL_PUBLIC_URL", label: "Public URL", group: "Telephony (real PSTN calls)", help: "Publicly reachable URL for Twilio media callbacks (not a secret).", secret: false, restart: true },
];

const GROUPS = Array.from(new Set(META.map((m) => m.group)));

export default function SecretsSettings() {
  const [status, setStatus] = useState<Record<string, SecretStatus>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  function ingest(list: SecretStatus[]) {
    const map: Record<string, SecretStatus> = {};
    for (const s of list) map[s.key] = s;
    setStatus(map);
  }

  useEffect(() => {
    fetch("/api/settings/secrets")
      .then((r) => r.json())
      .then((d: { secrets: SecretStatus[] }) => ingest(d.secrets ?? []))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(drafts)) {
        if (v.trim()) values[k] = v.trim();
      }
      const res = await fetch("/api/settings/secrets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const d: { secrets: SecretStatus[] } = await res.json();
      ingest(d.secrets ?? []);
      setDrafts({});
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  async function clearKey(key: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/secrets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: { [key]: null } }),
      });
      const d: { secrets: SecretStatus[] } = await res.json();
      ingest(d.secrets ?? []);
      setDrafts((prev) => {
        const n = { ...prev };
        delete n[key];
        return n;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-row">
        <strong>Secrets &amp; environment</strong>
        {saved && <span className="label label-pass">saved ✓</span>}
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
        Set the keys HAL needs here instead of environment variables. Stored server-side, never sent
        back to the browser. A real environment variable, if present, always wins and shows as{" "}
        <em>from env</em>.
      </p>

      {GROUPS.map((group) => (
        <div key={group}>
          <div className="field-label" style={{ marginTop: 14, textTransform: "uppercase", fontSize: 11, letterSpacing: 0.5 }}>
            {group}
          </div>
          {META.filter((m) => m.group === group).map((m) => {
            const st = status[m.key];
            const source = st?.source ?? "none";
            const fromEnv = source === "env";
            return (
              <label className="field" key={m.key}>
                <span className="field-label" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {m.label}
                  {loaded && source === "env" && <span className="label label-info">from env</span>}
                  {loaded && source === "stored" && <span className="label label-pass">set</span>}
                  {loaded && source === "none" && <span className="label label-neutral">not set</span>}
                  {m.restart && <span className="muted" style={{ fontSize: 11 }}>· restart to apply</span>}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type={m.secret === false ? "text" : "password"}
                    value={drafts[m.key] ?? ""}
                    disabled={fromEnv}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [m.key]: e.target.value }))}
                    placeholder={
                      fromEnv
                        ? "managed by environment variable"
                        : source === "stored"
                          ? "•••••••• (leave blank to keep)"
                          : m.secret === false
                            ? ""
                            : "paste value"
                    }
                    className={m.secret === false ? "mono" : undefined}
                  />
                  {source === "stored" && (
                    <button type="button" className="icon-btn" onClick={() => clearKey(m.key)} disabled={busy} title="Remove stored value">
                      Clear
                    </button>
                  )}
                </div>
                <span className="muted" style={{ fontSize: 12 }}>
                  <span className="mono">{m.key}</span> — {m.help}
                </span>
              </label>
            );
          })}
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
        <button onClick={save} disabled={busy || !loaded}>
          {busy ? "Saving…" : "Save secrets"}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          LLM keys apply immediately; telephony &amp; media-gateway keys take effect after an app restart.
        </span>
      </div>
    </div>
  );
}
