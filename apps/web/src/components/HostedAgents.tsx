"use client";

import { useEffect, useState, useCallback } from "react";

interface Integration {
  id: string;
  label: string;
  credentialFields: Array<{ key: string; label: string; required?: boolean; help?: string }>;
}
interface Account {
  id: string;
  provider: string;
  label: string;
  createdAt: number;
}
interface Agent {
  id: string;
  accountId: string;
  provider: string;
  externalAgentId: string;
  name: string;
  createdAt: number;
}

export default function HostedAgents() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [i, a, g] = await Promise.all([
      fetch("/api/hosted-integrations").then((r) => r.json()),
      fetch("/api/provider-accounts").then((r) => r.json()),
      fetch("/api/testing-agents").then((r) => r.json()),
    ]);
    setIntegrations(i.integrations);
    setAccounts(a.accounts);
    setAgents(g.agents);
  }, []);

  useEffect(() => {
    refresh().catch(() => setError("Failed to load"));
  }, [refresh]);

  return (
    <div className="grid" style={{ gap: 18 }}>
      {error && <div className="card" style={{ borderColor: "var(--fail)", color: "var(--fail)" }}>{error}</div>}
      <ConnectAccount integrations={integrations} onDone={refresh} />
      {accounts.length > 0 && <AccountsList accounts={accounts} />}
      <ProvisionAgent accounts={accounts} onDone={refresh} />
      <AgentsList agents={agents} accounts={accounts} />
    </div>
  );
}

function ConnectAccount({ integrations, onDone }: { integrations: Integration[]; onDone: () => void }) {
  const [provider, setProvider] = useState("");
  const [label, setLabel] = useState("");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const integration = integrations.find((i) => i.id === provider) ?? integrations[0];

  async function submit() {
    if (!integration) return;
    setBusy(true);
    try {
      await fetch("/api/provider-accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: integration.id, label, credentials: creds }),
      });
      setCreds({});
      setLabel("");
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>1. Connect a provider account</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Bring credentials for your voice platform. HAL uses them to create a testing agent on your
        behalf and to place calls. Credentials are stored server-side and never sent back to the browser.
      </p>
      <label className="field">
        <span className="field-label">Provider</span>
        <select value={integration?.id ?? ""} onChange={(e) => setProvider(e.target.value)}>
          {integrations.map((i) => (
            <option key={i.id} value={i.id}>{i.label}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Label</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My Vapi account" />
      </label>
      {integration?.credentialFields.map((f) => (
        <label className="field" key={f.key}>
          <span className="field-label">{f.label}{f.required ? " *" : ""}</span>
          <input
            type="password"
            value={creds[f.key] ?? ""}
            onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
          />
          {f.help && <span className="muted" style={{ fontSize: 12 }}>{f.help}</span>}
        </label>
      ))}
      <button onClick={submit} disabled={busy || !integration}>{busy ? "Connecting…" : "Connect account"}</button>
    </section>
  );
}

function AccountsList({ accounts }: { accounts: Account[] }) {
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Connected accounts</h2>
      <div className="grid" style={{ gap: 8 }}>
        {accounts.map((a) => (
          <AccountRow key={a.id} account={a} />
        ))}
      </div>
    </section>
  );
}

function AccountRow({ account }: { account: Account }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail?: string } | null>(null);

  async function test() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/provider-accounts/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: account.id }),
      });
      setResult(await res.json());
    } catch (e) {
      setResult({ ok: false, detail: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-row" style={{ background: "var(--panel-2)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
      <div>
        <strong>{account.label}</strong> <span className="pill telephony">{account.provider}</span>
        {result && (
          <div style={{ marginTop: 4 }}>
            {result.ok ? (
              <span className="label label-pass">connected ✓</span>
            ) : (
              <span className="label label-fail" title={result.detail}>failed</span>
            )}
            {!result.ok && result.detail && (
              <div className="muted mono" style={{ fontSize: 11, marginTop: 2 }}>{result.detail}</div>
            )}
          </div>
        )}
      </div>
      <button type="button" className="btn secondary" onClick={test} disabled={busy}>
        {busy ? "Testing…" : "Test connection"}
      </button>
    </div>
  );
}

function ProvisionAgent({ accounts, onDone }: { accounts: Account[]; onDone: () => void }) {
  const [accountId, setAccountId] = useState("");
  const [name, setName] = useState("HAL tester");
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a QA tester calling a business's voice AI. Try to book an appointment and confirm the details.",
  );
  const [firstMessage, setFirstMessage] = useState("Hi, I'd like to book an appointment.");
  const [useStructured, setUseStructured] = useState(false);
  const [structuredJson, setStructuredJson] = useState(
    JSON.stringify(
      {
        role: "You are a patient booking an appointment",
        conditions: [
          { id: 0, condition: "FIRST_MESSAGE", action: "Hi, I'd like to book an appointment.", type: "standard", fixed_message: true },
          { id: 1, condition: "The agent asks which day", action: "Ask for the first available Tuesday", type: "standard", fixed_message: false },
          { id: 2, condition: 1, action: "Great, thanks! <endcall />", type: "action_followup", fixed_message: true },
        ],
      },
      null,
      2,
    ),
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const selected = accountId || accounts[0]?.id || "";
  const selectedAccount = accounts.find((a) => a.id === selected);

  function structuredPayload() {
    if (!useStructured) return undefined;
    try {
      return JSON.parse(structuredJson);
    } catch {
      throw new Error("Structured test is not valid JSON");
    }
  }

  async function doPreview() {
    setErr(null);
    setPreview(null);
    try {
      const res = await fetch("/api/testing-agents/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: selectedAccount?.provider,
          name,
          systemPrompt,
          firstMessage,
          structured: structuredPayload(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      // Prefer the node-based flow config when the platform produced one.
      setPreview(JSON.stringify(data.flow ?? data.config, null, 2));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/testing-agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId: selected,
          name,
          systemPrompt,
          firstMessage,
          structured: structuredPayload(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>2. Provision a testing agent</h2>
      {accounts.length === 0 && <p className="muted">Connect an account first.</p>}
      {err && <div className="muted" style={{ color: "var(--fail)" }}>{err}</div>}
      <label className="field">
        <span className="field-label">Account</span>
        <select value={selected} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.label} ({a.provider})</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Agent name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="muted" style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center", marginBottom: 10 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={useStructured} onChange={(e) => setUseStructured(e.target.checked)} />
        Reproduce a structured (deterministic) test — compiled into this platform&apos;s native config
      </label>
      {useStructured ? (
        <label className="field">
          <span className="field-label">Structured test (role + conditions JSON)</span>
          <textarea value={structuredJson} onChange={(e) => setStructuredJson(e.target.value)} rows={10} className="mono" />
        </label>
      ) : (
        <>
          <label className="field">
            <span className="field-label">System prompt (the tester's behavior)</span>
            <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={3} />
          </label>
          <label className="field">
            <span className="field-label">First message</span>
            <input value={firstMessage} onChange={(e) => setFirstMessage(e.target.value)} />
          </label>
        </>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={submit} disabled={busy || accounts.length === 0}>
          {busy ? "Creating on provider…" : "Create testing agent"}
        </button>
        <button type="button" className="btn secondary" onClick={doPreview} disabled={accounts.length === 0}>
          Preview {selectedAccount?.provider ?? "platform"} config
        </button>
      </div>
      {preview && (
        <>
          <div className="field-label" style={{ marginTop: 12 }}>
            Native config HAL will send to {selectedAccount?.provider}
          </div>
          <pre className="mono" style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, overflow: "auto", fontSize: 12, maxHeight: 320 }}>
            {preview}
          </pre>
        </>
      )}
    </section>
  );
}

function AgentsList({ agents, accounts }: { agents: Agent[]; accounts: Account[] }) {
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>3. Testing agents</h2>
      {agents.length === 0 && <p className="muted">No testing agents yet.</p>}
      <div className="grid" style={{ gap: 10 }}>
        {agents.map((a) => (
          <AgentRow key={a.id} agent={a} account={accounts.find((x) => x.id === a.accountId)} />
        ))}
      </div>
    </section>
  );
}

function AgentRow({ agent, account }: { agent: Agent; account?: Account }) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: string; labels?: Array<{ text: string; tone: string }> } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function call() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch("/api/run-hosted", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: agent.id, phoneNumber: phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setResult(data.result);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ background: "var(--panel-2)", marginBottom: 0 }}>
      <div className="card-row">
        <div>
          <strong>{agent.name}</strong>{" "}
          <span className="pill telephony">{agent.provider}</span>
          <div className="muted mono" style={{ fontSize: 12 }}>
            agent {agent.externalAgentId} · {account?.label ?? agent.accountId}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+14155550123 (target number)" />
        <button onClick={call} disabled={busy || !phone.trim()}>{busy ? "Calling…" : "Place test call"}</button>
      </div>
      {err && <div className="muted" style={{ color: "var(--fail)", marginTop: 6 }}>{err}</div>}
      {result && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span className={`pill ${result.status}`}>{result.status}</span>
          {(result.labels ?? []).map((l, i) => (
            <span key={i} className={`label label-${l.tone}`}>{l.text}</span>
          ))}
        </div>
      )}
    </div>
  );
}
