"use client";

import { useState } from "react";

export default function MetadataJsonViewer({ json }: { json: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();

  async function copy() {
    setError(undefined);
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Could not copy JSON. Open it and select the text instead.");
    }
  }

  return <div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button className="secondary" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? "Hide JSON" : "View JSON"}</button>
      <button className="secondary" type="button" onClick={copy}>{copied ? "Copied" : "Copy JSON"}</button>
    </div>
    {error && <p role="alert" style={{ color: "var(--fail)" }}>{error}</p>}
    {open && <pre className="run-json" style={{ marginTop: 14, maxHeight: 560, overflow: "auto" }}>{json}</pre>}
  </div>;
}
