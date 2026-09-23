"use client";

import { useEffect, useState } from "react";

interface Public {
  provider: string;
  model?: string;
  hasKey: boolean;
  updatedAt: number;
}

/** Speech-to-text providers. `available: false` renders a disabled "soon" option
 *  so the dropdown communicates the roadmap without offering a broken choice. */
const PROVIDERS: Array<{ id: string; label: string; available: boolean; models?: string[]; keyHelp?: string }> = [
  {
    id: "deepgram",
    label: "Deepgram",
    available: true,
    models: ["nova-2", "nova-2-phonecall", "nova-3", "enhanced", "base"],
    keyHelp: "Create a key at console.deepgram.com → API Keys.",
  },
  { id: "assemblyai", label: "AssemblyAI (coming soon)", available: false },
  { id: "openai-whisper", label: "OpenAI Whisper (coming soon)", available: false },
];

export default function TranscriptionSettings() {
  const [loaded, setLoaded] = useState(false);
  const [provider, setProvider] = useState("deepgram");
  const [model, setModel] = useState("nova-2");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const active = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];

  useEffect(() => {
    fetch("/api/settings/transcription")
      .then((r) => r.json())
      .then((d: { settings: Public }) => {
        setProvider(d.settings.provider);
        if (d.settings.model) setModel(d.settings.model);
        setHasKey(d.settings.hasKey);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      const body: Record<string, string> = { provider, model };
      // Only send the key when the user typed one, so a blank field never wipes it.
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const res = await fetch("/api/settings/transcription", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d: { settings: Public } = await res.json();
      setHasKey(d.settings.hasKey);
      setApiKey("");
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-row">
        <strong>Transcription (speech-to-text)</strong>
        {loaded && (
          <span className={`label label-${hasKey ? "pass" : "neutral"}`}>
            {hasKey ? "key set" : "no key"}
          </span>
        )}
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
        Used to transcribe uploaded production calls before a judge scores them. The key is stored
        server-side and never sent back to the browser.
      </p>

      <label className="field" style={{ marginTop: 8 }}>
        <span className="field-label">Provider</span>
        <select
          value={provider}
          onChange={(e) => {
            const p = PROVIDERS.find((x) => x.id === e.target.value);
            if (!p || !p.available) return;
            setProvider(p.id);
            if (p.models && !p.models.includes(model)) setModel(p.models[0]);
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.available}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {active.models && (
        <label className="field">
          <span className="field-label">Model</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {active.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="field">
        <span className="field-label">API key</span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasKey ? "•••••••• (leave blank to keep current)" : "Paste your API key"}
        />
        {active.keyHelp && (
          <span className="muted" style={{ fontSize: 12 }}>
            {active.keyHelp}
          </span>
        )}
      </label>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
        <button onClick={save} disabled={busy || !loaded}>
          {busy ? "Saving…" : "Save"}
        </button>
        {saved && <span className="label label-pass">saved ✓</span>}
      </div>
    </div>
  );
}
