"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { TestResult } from "@hal/core";
export default function BlandChatRun({ testCaseId }: { testCaseId: string }) {
  const [accounts, setAccounts] = useState<Array<{ id: string; label: string; provider: string }>>([]);
  const [accountId, setAccountId] = useState("");
  const [pathways, setPathways] = useState<Array<{ id: string; name: string }>>([]);
  const [pathwayId, setPathwayId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TestResult | null>(null);
  useEffect(() => { let active = true; fetch("/api/provider-accounts").then((r) => r.json()).then((d) => { if (active) setAccounts(d.accounts.filter((a: { provider: string }) => a.provider === "bland")); }).catch(() => { if (active) setError("Could not load Bland accounts"); }); return () => { active = false; }; }, []);
  const selected = accountId || accounts[0]?.id || "";
  useEffect(() => { let active = true; setPathways([]); setPathwayId(""); if (selected) fetch(`/api/testing-agents/remote?accountId=${encodeURIComponent(selected)}`).then((r) => r.json()).then((d) => { if (active) { setPathways(d.agents ?? []); if (d.error) setError("Could not list pathways. You can paste a pathway ID."); } }).catch(() => { if (active) setError("Could not load pathways. Paste a pathway ID."); }); return () => { active = false; }; }, [selected]);
  async function run() {
    setBusy(true); setError(""); setResult(null);
    try { const res = await fetch("/api/run-bland-chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ testCaseId, accountId: selected, pathwayId }) }); const data = await res.json(); if (!res.ok) throw new Error(data.error ?? "Chat failed"); setResult(data.result); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div><p className="muted">Run the saved scenario as a text conversation with a Bland pathway. The transcript and judge results are saved to Results.</p>
    {!accounts.length ? <p>Connect a Bland account on <Link href="/agents">Providers</Link>.</p> : <>
      <fieldset disabled={busy} className="scenario-fields settings-grid">
        <label className="field"><span className="field-label">Bland account</span><select value={selected} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
        <div className="field"><label><span className="field-label">Target pathway</span><select value={pathways.some((p) => p.id === pathwayId) ? pathwayId : ""} onChange={(e) => setPathwayId(e.target.value)}><option value="">Choose a pathway or paste its ID</option>{pathways.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><input aria-label="Target Bland pathway ID" className="mono" value={pathwayId} onChange={(e) => setPathwayId(e.target.value)} placeholder="Pathway ID" /></div>
      </fieldset>
      <div className="action-bar"><span className="field-help">Text only · no phone number or Twilio key required</span><button onClick={run} disabled={busy || !pathwayId.trim()}>{busy ? "Running chat…" : "Run chat simulation"}</button></div>
    </>}
    {error && <p role="alert" className="error-text">{error}</p>}
    {result && <div className="chat-result"><p><span className={`pill ${result.status}`}>{result.status}</span> <Link href={`/results/${encodeURIComponent(result.id)}`}>View full chat results →</Link></p>{result.error && <p className="error-text">{result.error}</p>}<div className="transcript">{result.transcript.map((t, i) => <div key={i} className={`turn ${t.role}`}><div className="who">{t.role === "agent" ? "HAL tester" : "Bland target"}</div><div>{t.text}</div></div>)}</div></div>}
  </div>;
}
