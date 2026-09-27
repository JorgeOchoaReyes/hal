"use client";

import { useEffect, useState } from "react";
import AgentOutboundKey, { type OutboundKeyValue } from "./AgentOutboundKey";

interface Account { id: string; label: string; provider: string }
interface ExistingAgent extends OutboundKeyValue {
  id: string; accountId: string; name: string; externalAgentId: string; hasEncryptedKey?: boolean;
}
interface RemoteAgent { id: string; name: string; kind: string }

export default function ImportTestingAgent({ accounts, existing, onDone, onCancel }: {
  accounts: Account[]; existing?: ExistingAgent; onDone: () => void; onCancel: () => void;
}) {
  const [accountId, setAccountId] = useState(existing?.accountId ?? accounts[0]?.id ?? "");
  const [remoteId, setRemoteId] = useState(existing?.externalAgentId ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [agents, setAgents] = useState<RemoteAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [outboundKey, setOutboundKey] = useState<OutboundKeyValue>({});
  const account = accounts.find((a) => a.id === accountId);
  const resource = account?.provider === "bland" ? "pathway" : "agent";

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    setAgents([]); setNotice(""); setLoading(true);
    fetch(`/api/testing-agents/remote?accountId=${encodeURIComponent(accountId)}`)
      .then(async (r) => { if (!r.ok) throw new Error("Could not load existing agents. Paste the provider ID below."); return r.json(); })
      .then((data) => {
        if (!active) return;
        setAgents(data.agents ?? []);
        if (data.error) setNotice("Could not load existing agents. Paste the provider ID below.");
        else if (!data.agents?.length) setNotice("No agents were listed. You can paste the provider ID below.");
      })
      .catch((e) => { if (active) setNotice((e as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const res = await fetch("/api/testing-agents", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ importExisting: true, agentId: existing?.id, accountId, externalAgentId: remoteId.trim(), name: name.trim(), ...outboundKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not import testing agent");
      onDone();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit}>
    <p className="muted">Add a testing agent you already built on your provider. HAL links to its existing configuration without creating or changing it.</p>
    <fieldset disabled={busy} className="scenario-fields">
      <label className="field"><span className="field-label">Provider account</span>
        <select value={accountId} disabled={Boolean(existing)} onChange={(e) => { setAccountId(e.target.value); setRemoteId(""); setName(""); setOutboundKey({}); setError(""); }}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.provider})</option>)}
        </select>
      </label>
      <label className="field"><span className="field-label">Existing {resource}</span>
        <select disabled={loading} value={agents.some((a) => a.id === remoteId) ? remoteId : ""} onChange={(e) => { setRemoteId(e.target.value); const agent = agents.find((a) => a.id === e.target.value); if (agent) setName(agent.name); }}>
          <option value="">{loading ? "Loading…" : `Choose a ${resource} or paste its ID below`}</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      {notice && <p role="status" className="field-help">{notice}</p>}
      <label className="field"><span className="field-label">{account?.provider === "bland" ? "Bland pathway ID" : "Provider agent ID"}</span><input required className="mono" value={remoteId} onChange={(e) => setRemoteId(e.target.value)} placeholder={`Paste your existing ${resource} ID`} /></label>
      <label className="field"><span className="field-label">Name in HAL</span><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Appointment booking tester" /></label>
      {account?.provider === "bland" && <AgentOutboundKey key={accountId} accountId={accountId} initial={existing} hasKey={existing?.hasEncryptedKey} onChange={setOutboundKey} />}
    </fieldset>
    <p className="field-help">Calls use this tester’s provider configuration. When selected for a simulation, its judges score the call; its saved script does not replace the imported tester.</p>
    {error && <p role="alert" className="error-text">{error}</p>}
    <div className="button-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
      <button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      <button type="submit" disabled={busy || !accountId || !remoteId.trim() || !name.trim()}>{busy ? "Saving…" : existing ? "Save testing agent" : "Import testing agent"}</button>
    </div>
  </form>;
}
