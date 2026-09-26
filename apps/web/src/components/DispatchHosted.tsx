"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BlandChatRun from "./BlandChatRun";
import NumberPicker from "./NumberPicker";

interface Account {
  id: string;
  provider: string;
  label: string;
}
interface TestingAgentLite {
  accountId: string;
  id: string;
  name: string;
  provider: string;
}
interface TargetAgentLite {
  id: string;
  name: string;
  target: { transport: string; phoneNumber?: string };
}
interface TestCaseLite {
  targetAgentId?: string;
  testingAgentId?: string;
}

type AgentKind = "testing" | "target";
/** "kind:id" — id is "" for the testing side's "Auto — provision ad-hoc". */
type AgentValue = `${AgentKind}:${string}`;

const AUTO: AgentValue = "testing:";

function parse(value: string): { kind: AgentKind; id: string } {
  const i = value.indexOf(":");
  return { kind: value.slice(0, i) as AgentKind, id: value.slice(i + 1) };
}

/**
 * Ad-hoc dispatch of any simulation (steps or structured) to a hosted provider:
 * HAL compiles it into that platform's native agent config at dispatch time —
 * this is where "how to run it" is actually decided, not at creation — creates
 * (or reconfigures) the testing agent to match this simulation's current
 * persona/scenario, places the call, waits for it to finish, and pulls the
 * judged result from the provider.
 *
 * Either side of the call can be any saved agent — pick which one waits
 * (inbound) and which one places the call (outbound). One side must be a
 * testing agent (the one HAL manages and judges through) and the other a
 * saved agent under test.
 */
export default function DispatchHosted({ testCaseId }: { testCaseId: string }) {
  const [mode, setMode] = useState<"call" | "chat">("call");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [testingAgents, setTestingAgents] = useState<TestingAgentLite[]>([]);
  const [targets, setTargets] = useState<TargetAgentLite[]>([]);
  const [inbound, setInbound] = useState<AgentValue>("target:");
  const [outbound, setOutbound] = useState<AgentValue>(AUTO);
  const [phone, setPhone] = useState("");
  const [fromPhone, setFromPhone] = useState("");
  const [callerIdMode, setCallerIdMode] = useState("account");
  const [encryptedKey, setEncryptedKey] = useState("");
  const [savedKeys, setSavedKeys] = useState<Array<{ id: string; name: string }>>([]);
  const [byotKeyId, setByotKeyId] = useState("");
  const [keyName, setKeyName] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keysLoading, setKeysLoading] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [configureInbound, setConfigureInbound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{
    id: string;
    status: string;
    error?: string;
    externalCallId?: string;
    labels?: Array<{ text: string; tone: string }>;
    transcript?: Array<{ role: string; text: string }>;
  } | null>(null);

  useEffect(() => {
    fetch("/api/provider-accounts")
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts))
      .catch(() => setErr("Failed to load accounts"));
    fetch("/api/testing-agents")
      .then((r) => r.json())
      .then((d: { agents?: TestingAgentLite[] }) => setTestingAgents(d.agents ?? []))
      .catch(() => undefined);
    fetch("/api/targets")
      .then((r) => r.json())
      .then((d: { targets?: TargetAgentLite[] }) => setTargets(d.targets ?? []))
      .catch(() => undefined);
    fetch(`/api/testcases/${testCaseId}`)
      .then((r) => r.json())
      .then((d: { testCase?: TestCaseLite }) => {
        const tc = d.testCase;
        if (!tc) return;
        setOutbound(`testing:${tc.testingAgentId ?? ""}`);
        if (tc.targetAgentId) setInbound(`target:${tc.targetAgentId}`);
      })
      .catch(() => undefined);
  }, [testCaseId]);

  const selected = accountId || accounts[0]?.id || "";

  const options: { value: AgentValue; label: string }[] = [
    { value: AUTO, label: "Testing agent: Auto — provision ad-hoc" },
    ...testingAgents.filter((a) => a.accountId === selected).map((a): { value: AgentValue; label: string } => ({
      value: `testing:${a.id}`,
      label: `Testing agent: ${a.name} (${a.provider})`,
    })),
    ...targets.map((t): { value: AgentValue; label: string } => ({
      value: `target:${t.id}`,
      label: `Agent under test: ${t.name}`,
    })),
  ];

  const inboundParsed = parse(inbound);
  const outboundParsed = parse(outbound);
  const inboundTarget = inboundParsed.kind === "target" ? targets.find((t) => t.id === inboundParsed.id) : undefined;


  // The phone field is always the INBOUND agent's own number — the one the
  // outbound side dials. Caller ID must be selected explicitly: a saved
  // target number does not prove ownership on the selected provider account.
  useEffect(() => {
    if (inboundTarget?.target.phoneNumber) setPhone(inboundTarget.target.phoneNumber);
  }, [inboundTarget]);
  useEffect(() => {
    setFromPhone("");
    setEncryptedKey("");
    setCallerIdMode("account");
    setConfigureInbound(false);
  }, [selected, outbound]);

  const sameAgent = inbound === outbound;
  const bothTesting = inboundParsed.kind === "testing" && parse(outbound).kind === "testing";
  const bothTarget = inboundParsed.kind === "target" && parse(outbound).kind === "target";
  const chosenTesting = testingAgents.find((a) => a.id === (inboundParsed.kind === "testing" ? inboundParsed.id : outboundParsed.id));
  const accountMismatch = Boolean(chosenTesting && chosenTesting.accountId !== selected);
  const invalidPair = sameAgent || bothTesting || bothTarget || accountMismatch;
  const isBland = accounts.find((a) => a.id === selected)?.provider === "bland";
  const outboundIsTarget = outboundParsed.kind === "target";

  useEffect(() => {
    let cancelled = false;
    setSavedKeys([]); setByotKeyId(""); setKeyName(""); setKeyError(null);
    setKeysLoading(isBland);
    if (isBland) fetch(`/api/byot-keys?accountId=${encodeURIComponent(selected)}`)
      .then(async (r) => { if (!r.ok) throw new Error("Could not load saved keys"); return r.json(); })
      .then((d) => { if (!cancelled) setSavedKeys(d.keys); })
      .catch((e) => { if (!cancelled) setKeyError(e.message); })
      .finally(() => { if (!cancelled) setKeysLoading(false); });
    return () => { cancelled = true; };
  }, [selected, isBland]);

  async function saveKey() {
    setKeyBusy(true); setKeyError(null);
    try {
      const res = await fetch("/api/byot-keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: selected, name: keyName, encryptedKey }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save key");
      setSavedKeys((keys) => [...keys, data.key]); setByotKeyId(data.key.id); setEncryptedKey(""); setKeyName("");
    } catch (e) { setKeyError((e as Error).message); }
    finally { setKeyBusy(false); }
  }

  async function removeKey() {
    setKeyBusy(true); setKeyError(null);
    try {
      const res = await fetch(`/api/byot-keys?accountId=${encodeURIComponent(selected)}&id=${encodeURIComponent(byotKeyId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not remove saved key");
      setSavedKeys((keys) => keys.filter((key) => key.id !== byotKeyId)); setByotKeyId("");
    } catch (e) { setKeyError((e as Error).message); }
    finally { setKeyBusy(false); }
  }

  async function dispatch() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch("/api/run-hosted-sim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          testCaseId,
          accountId: selected,
          phoneNumber: phone,
          fromNumber: isBland && callerIdMode === "pool" ? "" : callerIdMode === "custom" ? fromPhone.trim() : undefined,
          byotKeyId: isBland && callerIdMode !== "pool" ? byotKeyId || undefined : undefined,
          encryptedKey: isBland && callerIdMode !== "pool" && !byotKeyId ? encryptedKey.trim() || undefined : undefined,
          configureInbound,
          inboundAgent: parse(inbound),
          outboundAgent: parse(outbound),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setResult(data.result);
      setEncryptedKey("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card hosted-panel">
      <div className="section-heading"><div><h3>Hosted testing</h3><p className="muted">Run the saved scenario against your provider.</p></div>
        <div className="mode-switch" aria-label="Test channel">
          <button className={mode === "call" ? "active" : "secondary"} aria-pressed={mode === "call"} disabled={busy} onClick={() => setMode("call")}>Phone call</button>
          <button className={mode === "chat" ? "active" : "secondary"} aria-pressed={mode === "chat"} disabled={busy} onClick={() => setMode("chat")}>Bland chat</button>
        </div>
      </div>
      {mode === "chat" ? <BlandChatRun testCaseId={testCaseId} /> : accounts.length === 0 ? <p className="muted">Connect an account on <Link href="/agents">Providers</Link> to place a call.</p> : <>
        <label className="field account-picker"><span className="field-label">Provider account</span>
          <select disabled={busy || keyBusy || keysLoading} value={selected} onChange={(e) => { setAccountId(e.target.value); if (inboundParsed.kind === "testing") { setInbound(AUTO); setPhone(""); } if (outboundParsed.kind === "testing") setOutbound(AUTO); }}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.provider})</option>)}
          </select>
        </label>
        <fieldset disabled={busy || keyBusy} className="scenario-fields">
          <div className="call-participants">
            <section className="participant-panel"><div className="section-heading"><h4>Caller</h4><span className="pill outbound">Outbound</span></div>
              <label className="field"><span className="field-label">Agent placing the call</span><select value={outbound} onChange={(e) => setOutbound(e.target.value as AgentValue)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
              <label className="field"><span className="field-label">Caller ID</span><select value={callerIdMode} onChange={(e) => setCallerIdMode(e.target.value)}><option value="account">Account default</option>{isBland && <option value="pool">Bland default pool</option>}<option value="custom">Choose a number</option></select></label>
              {callerIdMode === "custom" && <NumberPicker accountId={selected} value={fromPhone} onChange={setFromPhone} ariaLabel="Outbound caller ID" placeholder="+14155550123" />}
              <p className="field-help">{isBland ? "Use a number owned by this account, including + and country code." : "Vapi and ElevenLabs use the number ID saved on the account."}</p>
            </section>
            <section className="participant-panel"><div className="section-heading"><h4>Receiver</h4><span className="pill inbound">Inbound</span></div>
              <label className="field"><span className="field-label">Agent answering the call</span><select value={inbound} onChange={(e) => setInbound(e.target.value as AgentValue)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
              <div className="field"><span className="field-label">Destination number</span><NumberPicker accountId={selected} value={phone} onChange={setPhone} ariaLabel="Inbound destination number" placeholder="+14155550123" /></div>
              <p className="field-help">The number the caller will dial.</p>
            </section>
          </div>
          {isBland && callerIdMode !== "pool" && <details className="outbound-settings"><summary>Twilio caller credentials <span className="muted">· optional, outbound only</span></summary>
            <p className="field-help">Leave blank to use the caller agent’s saved key, then the account default. The receiving agent’s key is not used.</p>
            <label className="field"><span className="field-label">Saved BYOT key</span><select disabled={keysLoading} value={byotKeyId} onChange={(e) => { setByotKeyId(e.target.value); setEncryptedKey(""); }}><option value="">Use caller default or enter a key</option>{savedKeys.map((key) => <option key={key.id} value={key.id}>{key.name}</option>)}</select></label>
            {byotKeyId ? <button type="button" className="secondary" onClick={removeKey}>Remove saved key</button> : <div className="settings-grid">
              <label className="field"><span className="field-label">Bland encrypted key</span><input type="password" autoComplete="off" spellCheck={false} value={encryptedKey} onChange={(e) => setEncryptedKey(e.target.value)} placeholder="Paste the BYOT encrypted key" /></label>
              <label className="field"><span className="field-label">Name for reuse</span><input maxLength={120} value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="e.g. Main Twilio" /></label>
              <button type="button" className="secondary" onClick={saveKey} disabled={keysLoading || !encryptedKey.trim() || !keyName.trim()}>{keyBusy ? "Saving…" : "Save key"}</button>
            </div>}
            {keyError && <p role="alert" className="error-text">{keyError}</p>}
          </details>}
          {outboundIsTarget && <label className="confirmation-row"><input type="checkbox" checked={configureInbound} onChange={(e) => setConfigureInbound(e.target.checked)} /><span>Configure the dedicated receiving test number with this scenario. This replaces its current pathway and stays set after the run.</span></label>}
          {invalidPair && <p role="alert" className="error-text">Choose one testing agent from this account and one agent under test.</p>}
        </fieldset>
        <div className="action-bar"><span className="field-help">Uses the saved scenario below. This places a real phone call.</span><button onClick={dispatch} disabled={busy || keyBusy || keysLoading || !phone.trim() || invalidPair || (callerIdMode === "custom" && !fromPhone.trim()) || (outboundIsTarget && !configureInbound)}>{busy ? "Call in progress…" : "Place test call"}</button></div>
      </>}
      {mode === "call" && err && <div className="muted" style={{ color: "var(--fail)", marginTop: 8 }}>{err}</div>}
      {mode === "call" && result && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span className={`pill ${result.status}`}>{result.status}</span>
            {(result.labels ?? []).filter((l) => l.text.toLowerCase() !== result.status.toLowerCase()).map((l, i) => (
              <span key={i} className={`label label-${l.tone}`}>{l.text}</span>
            ))}
            {result.externalCallId && (
              <span className="muted mono" style={{ fontSize: 12 }}>
                call {result.externalCallId}
              </span>
            )}
          </div>
          <p><Link href={`/results/${encodeURIComponent(result.id)}`}>View full run details →</Link></p>
          {result.error && (
            <div
              className="mono"
              style={{
                marginTop: 8,
                padding: 10,
                borderRadius: 8,
                border: "1px solid var(--fail)",
                color: "var(--fail)",
                fontSize: 12,
                whiteSpace: "pre-wrap",
              }}
            >
              {result.error}
            </div>
          )}
          {(result.transcript?.length ?? 0) > 0 && (
            <details style={{ marginTop: 12 }}><summary>View transcript</summary><div className="transcript">
              {result.transcript!.map((u, i) => (
                <div className={`turn ${u.role}`} key={i}>
                  <div className="who">{u.role}</div>
                  <div>{u.text}</div>
                </div>
              ))}
            </div></details>
          )}
        </div>
      )}
    </div>
  );
}
