"use client";
import { useEffect, useState } from "react";
export interface OutboundKeyValue { byotKeyId?: string; byotAccountId?: string; encryptedKey?: string }
export default function AgentOutboundKey({ accountId, initial, hasKey, onChange }: { accountId?: string; initial?: OutboundKeyValue; hasKey?: boolean; onChange: (value: OutboundKeyValue) => void }) {
  const [accounts, setAccounts] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedAccount, setSelectedAccount] = useState(accountId ?? initial?.byotAccountId ?? "");
  const [keys, setKeys] = useState<Array<{ id: string; name: string }>>([]);
  const [mode, setMode] = useState(initial?.byotKeyId ?? (hasKey ? "__existing__" : ""));
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const selected = accountId ?? selectedAccount;
  useEffect(() => { if (accountId) return; let live = true; fetch("/api/provider-accounts").then((r) => r.json()).then((d) => { if (live) setAccounts(d.accounts.filter((a: { provider: string }) => a.provider === "bland")); }).catch(() => { if (live) setError("Could not load accounts"); }); return () => { live = false; }; }, [accountId]);
  useEffect(() => { let live = true; setKeys([]); if (selected) fetch(`/api/byot-keys?accountId=${encodeURIComponent(selected)}`).then((r) => r.json()).then((d) => { if (live) { setKeys(d.keys ?? []); setError(d.error ?? ""); } }).catch(() => { if (live) setError("Could not load saved keys"); }); return () => { live = false; }; }, [selected]);
  function choose(value: string) { setMode(value); setSecret(""); if (value === "__existing__") onChange({ byotKeyId: "" }); else onChange({ byotAccountId: selected, byotKeyId: value === "__new__" ? "" : value, encryptedKey: value === "__new__" ? undefined : "" }); }
  return <details className="outbound-settings" open={Boolean(initial?.byotKeyId || hasKey)}><summary>Outbound Twilio credentials <span className="muted">(optional)</span></summary>
    <p className="field-help">Used only when this agent places a phone call using a Twilio number. Inbound calls and chat do not require this key.</p>
    {!accountId && <label className="field"><span className="field-label">Bland account for saved keys</span><select value={selected} onChange={(e) => { setSelectedAccount(e.target.value); setMode(""); onChange({ byotAccountId: e.target.value, byotKeyId: "", encryptedKey: "" }); }}><option value="">Select an account to use saved keys</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>}
    <label className="field"><span className="field-label">Caller’s BYOT key</span><select value={mode} onChange={(e) => choose(e.target.value)}><option value="">Use provider account default</option>{hasKey && <option value="__existing__">Keep this agent’s stored key</option>}{initial?.byotKeyId && !keys.some((k) => k.id === initial.byotKeyId) && <option value={initial.byotKeyId}>Previously selected saved key</option>}{keys.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}<option value="__new__">Enter a key for this agent</option></select></label>
    {mode === "__new__" && <label className="field"><span className="field-label">Bland encrypted key</span><input type="password" autoComplete="off" value={secret} onChange={(e) => { setSecret(e.target.value); onChange({ byotKeyId: "", byotAccountId: selected, encryptedKey: e.target.value }); }} placeholder="Paste encrypted_key from Bland" /><small className="field-help">Saved securely with this agent when you save changes.</small></label>}
    {error && <p role="alert" className="error-text">{error}</p>}
  </details>;
}
