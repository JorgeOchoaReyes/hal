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
}

interface Group {
  name: string;
  restart?: boolean; // whole group needs an app restart to take effect
  items: Meta[];
}

const GROUPS: Group[] = [
  {
    name: "AI models",
    items: [
      { key: "OPENAI_API_KEY", label: "OpenAI", group: "AI models", help: "LLM judge & simulated caller (OpenAI or auto)." },
      { key: "ANTHROPIC_API_KEY", label: "Anthropic", group: "AI models", help: "Claude-based judging / simulation." },
    ],
  },
  {
    name: "Speech",
    restart: true,
    items: [
      { key: "DEEPGRAM_API_KEY", label: "Deepgram", group: "Speech", help: "Live WebRTC/SIP media gateway. (Uploaded-call transcription is set above.)" },
    ],
  },
  {
    name: "Phone calls (Twilio)",
    restart: true,
    items: [
      { key: "TWILIO_ACCOUNT_SID", label: "Account SID", group: "Phone calls (Twilio)", help: "Twilio account for real PSTN calls." },
      { key: "TWILIO_AUTH_TOKEN", label: "Auth token", group: "Phone calls (Twilio)", help: "Twilio auth token." },
      { key: "TWILIO_FROM_NUMBER", label: "From number", group: "Phone calls (Twilio)", help: "Caller ID in E.164, e.g. +14155550123.", secret: false },
      { key: "HAL_PUBLIC_URL", label: "Public URL", group: "Phone calls (Twilio)", help: "Publicly reachable URL for Twilio callbacks.", secret: false },
    ],
  },
];

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
      setTimeout(() => setSaved(false), 2500);
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

  const dirty = Object.values(drafts).some((v) => v.trim());

  return (
    <div className="card">
      <div className="card-row">
        <strong>Secrets &amp; environment</strong>
        {saved && <span className="label label-pass">saved ✓</span>}
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Add the keys HAL needs. Stored server-side, never shown back. A real environment variable always
        wins and shows <em>from env</em>.
      </p>

      {GROUPS.map((group) => (
        <div key={group.name} style={{ marginTop: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            {group.name}
            {group.restart && (
              <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: "none" }}>
                · restart to apply
              </span>
            )}
          </div>

          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
            {group.items.map((m) => {
              const st = status[m.key];
              const source = st?.source ?? "none";
              const fromEnv = source === "env";
              return (
                <div
                  key={m.key}
                  className="secret-row"
                  style={{ display: "flex", alignItems: "center", gap: 10 }}
                >
                  <span
                    title={`${m.key} — ${m.help}`}
                    style={{ width: 120, flexShrink: 0, fontSize: 13, fontWeight: 600 }}
                  >
                    {m.label}
                  </span>
                  <input
                    type={m.secret === false ? "text" : "password"}
                    value={drafts[m.key] ?? ""}
                    disabled={fromEnv}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [m.key]: e.target.value }))}
                    placeholder={
                      fromEnv
                        ? "managed by environment"
                        : source === "stored"
                          ? "•••••• saved — type to replace"
                          : m.secret === false
                            ? m.key === "TWILIO_FROM_NUMBER"
                              ? "+14155550123"
                              : "https://…"
                            : "paste value"
                    }
                    className={m.secret === false ? "mono" : undefined}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  {loaded && (
                    <span
                      style={{ width: 66, flexShrink: 0, textAlign: "right" }}
                      title={source === "env" ? "Set via environment variable" : source === "stored" ? "Saved" : "Not set"}
                    >
                      {source === "env" && <span className="label label-info">env</span>}
                      {source === "stored" && (
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => clearKey(m.key)}
                          disabled={busy}
                          title="Remove stored value"
                          style={{ padding: "2px 8px", fontSize: 12 }}
                        >
                          Clear
                        </button>
                      )}
                      {source === "none" && <span className="label label-neutral">not set</span>}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 18 }}>
        <button onClick={save} disabled={busy || !loaded || !dirty}>
          {busy ? "Saving…" : "Save"}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          AI keys apply immediately; speech &amp; Twilio need an app restart.
        </span>
      </div>
    </div>
  );
}
