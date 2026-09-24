"use client";

import { useEffect, useState } from "react";

type Source = "env" | "stored" | "none";
interface SecretStatus {
  key: string;
  set: boolean;
  source: Source;
}

type Requirement = "one-of" | "optional";

interface Meta {
  key: string;
  label: string;
  group: string;
  help: string;
  req: Requirement;
  secret?: boolean; // password field (default true)
}

interface Group {
  name: string;
  note?: string; // requirement summary shown next to the group header
  restart?: boolean; // whole group needs an app restart to take effect
  items: Meta[];
}

const GROUPS: Group[] = [
  {
    name: "AI models",
    items: [
      { key: "OPENAI_API_KEY", label: "OpenAI", group: "AI models", req: "one-of", help: "LLM judge & simulated caller (OpenAI or auto)." },
      { key: "ANTHROPIC_API_KEY", label: "Anthropic", group: "AI models", req: "one-of", help: "Claude-based judging / simulation." },
      { key: "GEMINI_API_KEY", label: "Gemini", group: "AI models", req: "one-of", help: "Google Gemini judging / simulation." },
    ],
  },
  {
    name: "Speech",
    restart: true,
    items: [
      { key: "DEEPGRAM_API_KEY", label: "Deepgram", group: "Speech", req: "optional", help: "Live WebRTC/SIP media gateway. (Uploaded-call transcription is set above.)" },
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
  const hasAiKey =
    (status.OPENAI_API_KEY?.set ?? false) ||
    (status.ANTHROPIC_API_KEY?.set ?? false) ||
    (status.GEMINI_API_KEY?.set ?? false);

  return (
    <div className="card">
      <div className="card-row">
        <strong>Secrets &amp; environment</strong>
        {saved && <span className="label label-pass">saved ✓</span>}
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Add the keys HAL needs. Stored server-side, never shown back. A real environment variable always
        wins and shows <em>from env</em>. <span style={{ color: "var(--fail)" }}>*</span> marks a required
        key — set at least one AI model key.
      </p>

      {loaded && !hasAiKey && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 12px",
            borderRadius: 8,
            background: "var(--accent-dim)",
            color: "var(--accent)",
            fontSize: 13,
          }}
        >
          <strong>Set at least one AI model key</strong> (OpenAI, Anthropic, or Gemini) to run real simulations and
          LLM judging. Without one, HAL falls back to a mock model. Real phone calls also need a provider
          connected under <em>Providers</em>.
        </div>
      )}

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
            {group.note && (
              <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: "none" }}>
                · {group.note}
              </span>
            )}
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
                    style={{ width: 120, flexShrink: 0, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 2 }}
                  >
                    {m.label}
                    {m.req === "one-of" && (
                      <span style={{ color: "var(--fail)" }} title="Required — set at least one">
                        *
                      </span>
                    )}
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
          AI keys apply immediately; the speech key needs an app restart.
        </span>
      </div>
    </div>
  );
}
