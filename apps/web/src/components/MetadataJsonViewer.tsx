"use client";

import { useState } from "react";

interface MetadataView {
  id: "testingAgent" | "targetAgent" | "both";
  label: string;
  json: string;
  hasCallRecord: boolean;
}

export default function MetadataJsonViewer({ views }: { views: MetadataView[] }) {
  const [selected, setSelected] = useState<MetadataView["id"]>(views.find((view) => view.hasCallRecord)?.id ?? "both");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const active = views.find((view) => view.id === selected) ?? views[0];

  async function copy() {
    setError(undefined);
    try {
      await navigator.clipboard.writeText(active.json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Could not copy JSON. Open it and select the text instead.");
    }
  }

  return <div>
    <label className="field" style={{ maxWidth: 330, marginBottom: 14 }}>
      <span className="field-label">Metadata to view</span>
      <select value={selected} onChange={(event) => { setSelected(event.target.value as MetadataView["id"]); setCopied(false); setError(undefined); }}>
        {views.map((view) => <option key={view.id} value={view.id}>{view.label}</option>)}
      </select>
    </label>
    {selected !== "both" && !active.hasCallRecord && <p className="muted" role="status">No separate provider call record is linked for this agent yet. This JSON contains any transcript and activity already captured. Add the call ID above to fetch its full record.</p>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button className="secondary" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? "Hide JSON" : "View JSON"}</button>
      <button className="secondary" type="button" onClick={copy}>{copied ? "Copied" : "Copy JSON"}</button>
    </div>
    {error && <p role="alert" style={{ color: "var(--fail)" }}>{error}</p>}
    {open && <pre className="run-json" style={{ marginTop: 14, maxHeight: 560, overflow: "auto" }}>{active.json}</pre>}
  </div>;
}
