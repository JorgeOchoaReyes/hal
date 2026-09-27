"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { TestResult } from "@hal/core";
export default function HostedChatRun({ testCaseId }: { testCaseId: string }) {
  const [accounts, setAccounts] = useState<Array<{ id: string; label: string; provider: string }>>([]);
  const [accountId, setAccountId] = useState("");
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [agentId, setAgentId] = useState("");
  const [resourceKind, setResourceKind] = useState<"assistant" | "squad">("assistant");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TestResult | null>(null);
  useEffect(() => { let active = true; fetch("/api/provider-accounts").then((r) => r.json()).then((d) => { if (active) setAccounts(d.accounts.filter((a: { provider: string }) => ["bland", "vapi", "retell", "elevenlabs"].includes(a.provider))); }).catch(() => { if (active) setError("Could not load provider accounts"); }); return () => { active = false; }; }, []);
  const selected = accountId || accounts[0]?.id || "";
  const provider = accounts.find((account) => account.id === selected)?.provider ?? "";
  useEffect(() => { let active = true; setAgents([]); setAgentId(""); if (selected) fetch(`/api/testing-agents/remote?accountId=${encodeURIComponent(selected)}`).then((r) => r.json()).then((d) => { if (active) { setAgents(d.agents ?? []); if (d.error) setError("Could not list agents. You can paste an agent ID."); } }).catch(() => { if (active) setError("Could not load agents. Paste an agent ID."); }); return () => { active = false; }; }, [selected]);
  async function run() {
    setBusy(true); setError(""); setResult(null);
    try { const res = await fetch("/api/run-hosted-chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ testCaseId, accountId: selected, agentId, resourceKind }) }); const data = await res.json(); if (!res.ok) throw new Error(data.error ?? "Chat failed"); setResult(data.result); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div><p className="muted">Run the saved scenario as a text conversation with a provider agent. The transcript and judge results are saved to Results.</p>
    {!accounts.length ? <p>Connect a provider account on <Link href="/agents">Providers</Link>.</p> : <>
      <fieldset disabled={busy} className="scenario-fields settings-grid">
        <label className="field"><span className="field-label">Provider account</span><select value={selected} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.provider})</option>)}</select></label>
        <div className="field"><label><span className="field-label">Target {provider === "bland" ? "pathway" : "agent"}</span><select value={agents.some((a) => a.id === agentId) ? agentId : ""} onChange={(e) => setAgentId(e.target.value)}><option value="">Choose an agent or paste its ID</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><input aria-label="Target provider agent ID" className="mono" value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder={provider === "bland" ? "Pathway ID" : "Agent ID"} /></div>
        {provider === "vapi" && <label className="field"><span className="field-label">Vapi resource</span><select value={resourceKind} onChange={(e) => setResourceKind(e.target.value as "assistant" | "squad")}><option value="assistant">Assistant</option><option value="squad">Squad</option></select></label>}
      </fieldset>
      <div className="action-bar"><span className="field-help">Text only · no phone number required</span><button onClick={run} disabled={busy || !agentId.trim()}>{busy ? "Running chat…" : "Run chat simulation"}</button></div>
    </>}
    {error && <p role="alert" className="error-text">{error}</p>}
    {result && <div className="chat-result"><p><span className={`pill ${result.status}`}>{result.status}</span> <Link href={`/results/${encodeURIComponent(result.id)}`}>View full chat results →</Link></p>{result.error && <p className="error-text">{result.error}</p>}<div className="transcript">{result.transcript.map((t, i) => <div key={i} className={`turn ${t.role}`}><div className="who">{t.role === "agent" ? "HAL tester" : `${provider} target`}</div><div>{t.text}</div></div>)}</div></div>}
  </div>;
}
