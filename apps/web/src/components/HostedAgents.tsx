"use client";

import { useEffect, useState, useCallback } from "react";
import Modal from "./Modal";

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

export default function HostedAgents() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [i, a] = await Promise.all([
      fetch("/api/hosted-integrations").then((r) => r.json()),
      fetch("/api/provider-accounts").then((r) => r.json()),
    ]);
    setIntegrations(i.integrations);
    setAccounts(a.accounts);
  }, []);

  useEffect(() => {
    refresh().catch(() => setError("Failed to load"));
  }, [refresh]);

  return (
    <div className="grid" style={{ gap: 18 }}>
      {error && (
        <div className="card" style={{ borderColor: "var(--fail)", color: "var(--fail)" }}>
          {error}
        </div>
      )}

      <div className="toolbar" style={{ margin: "4px 0 0" }}>
        <div className="muted" style={{ fontSize: 13 }}>
          {accounts.length} account{accounts.length === 1 ? "" : "s"}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="secondary" onClick={() => setConnectOpen(true)}>
            + Connect provider
          </button>
        </div>
      </div>

      <section>
        <h2 style={{ marginTop: 8 }}>Connected accounts</h2>
        {accounts.length === 0 ? (
          <div className="card muted">
            No provider accounts yet. Connect one to provision a testing agent.
          </div>
        ) : (
          <div className="grid stagger" style={{ gap: 8 }}>
            {accounts.map((a) => (
              <AccountRow key={a.id} account={a} />
            ))}
          </div>
        )}
      </section>

      <Modal open={connectOpen} onClose={() => setConnectOpen(false)} title="Connect a provider account">
        <ConnectAccount
          integrations={integrations}
          onDone={() => {
            setConnectOpen(false);
            refresh();
          }}
          onCancel={() => setConnectOpen(false)}
        />
      </Modal>
    </div>
  );
}

function ConnectAccount({
  integrations,
  onDone,
  onCancel,
}: {
  integrations: Integration[];
  onDone: () => void;
  onCancel: () => void;
}) {
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
    <>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Bring credentials for your voice platform. HAL uses them to create a testing agent on your
        behalf and to place calls. Credentials are stored server-side and never sent back to the
        browser.
      </p>
      <label className="field">
        <span className="field-label">Provider</span>
        <select value={integration?.id ?? ""} onChange={(e) => setProvider(e.target.value)}>
          {integrations.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Label</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My Vapi account" />
      </label>
      {integration?.credentialFields.map((f) => (
        <label className="field" key={f.key}>
          <span className="field-label">
            {f.label}
            {f.required ? " *" : ""}
          </span>
          <input
            type="password"
            value={creds[f.key] ?? ""}
            onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
          />
          {f.help && (
            <span className="muted" style={{ fontSize: 12 }}>
              {f.help}
            </span>
          )}
        </label>
      ))}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button onClick={submit} disabled={busy || !integration}>
          {busy ? "Connecting…" : "Connect account"}
        </button>
      </div>
    </>
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
    <div
      className="card-row"
      style={{
        background: "var(--panel)",
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid var(--border)",
      }}
    >
      <div>
        <strong>{account.label}</strong> <span className="pill telephony">{account.provider}</span>
        {result && (
          <div style={{ marginTop: 4 }}>
            {result.ok ? (
              <span className="label label-pass">connected ✓</span>
            ) : (
              <span className="label label-fail" title={result.detail}>
                failed
              </span>
            )}
            {!result.ok && result.detail && (
              <div className="muted mono" style={{ fontSize: 11, marginTop: 2 }}>
                {result.detail}
              </div>
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
