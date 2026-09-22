"use client";

import { useEffect, useState } from "react";
import NumberPicker from "./NumberPicker";

interface Account {
  id: string;
  provider: string;
  label: string;
}

/**
 * Ad-hoc dispatch of a structured simulation to a hosted provider: HAL compiles
 * the simulation into that platform's native agent config at dispatch time,
 * creates the agent, places the call, and judges it.
 */
export default function DispatchHosted({ testCaseId }: { testCaseId: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: string; labels?: Array<{ text: string; tone: string }> } | null>(null);

  useEffect(() => {
    fetch("/api/provider-accounts")
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts))
      .catch(() => setErr("Failed to load accounts"));
  }, []);

  const selected = accountId || accounts[0]?.id || "";

  async function dispatch() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch("/api/run-hosted-sim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ testCaseId, accountId: selected, phoneNumber: phone }),
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
    <div className="card">
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Dispatch this simulation to a hosted platform. HAL compiles it into the platform&apos;s
        native agent config, creates the agent, calls your number, and judges the result.
      </p>
      {accounts.length === 0 ? (
        <p className="muted">
          No provider accounts yet — connect one on <a href="/agents">Hosted agents</a>.
        </p>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={selected} onChange={(e) => setAccountId(e.target.value)} style={{ width: "auto" }}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} ({a.provider})
              </option>
            ))}
          </select>
          <NumberPicker
            accountId={selected}
            value={phone}
            onChange={setPhone}
            placeholder="+14155550123 (target)"
          />
          <button onClick={dispatch} disabled={busy || !phone.trim()}>
            {busy ? "Dispatching…" : "Dispatch to provider"}
          </button>
        </div>
      )}
      {err && <div className="muted" style={{ color: "var(--fail)", marginTop: 8 }}>{err}</div>}
      {result && (
        <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span className={`pill ${result.status}`}>{result.status}</span>
          {(result.labels ?? []).map((l, i) => (
            <span key={i} className={`label label-${l.tone}`}>{l.text}</span>
          ))}
        </div>
      )}
    </div>
  );
}
