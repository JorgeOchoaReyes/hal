"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import HostedChatRun from "./HostedChatRun";
import NumberPicker from "./NumberPicker";
import { useSecretVisibility } from "./SecretVisibilityContext";

interface Account {
  id: string;
  provider: string;
  label: string;
}
interface CallerCredential {
  byotKeyId?: string;
  byotAccountId?: string;
  hasEncryptedKey?: boolean;
}
interface TestingAgentLite extends CallerCredential {
  imported?: boolean;
  accountId: string;
  id: string;
  name: string;
  provider: string;
  externalAgentId?: string;
  spec?: { structured?: unknown; steps?: unknown[]; pathwayId?: string };
}
interface TargetAgentLite extends CallerCredential {
  id: string;
  name: string;
  externalAgentId?: string;
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
 * persona/scenario, places the call, and opens a result page that tracks it.
 *
 * Either side of the call can be any saved agent — pick which one waits
 * (inbound) and which one places the call (outbound). One side must be a
 * testing agent (the one HAL manages and judges through) and the other a
 * saved agent under test.
 */
export default function DispatchHosted({ testCaseId }: { testCaseId: string }) {
  const router = useRouter();
  const { visible: credentialsVisible } = useSecretVisibility();
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
  const [customKey, setCustomKey] = useState(false);
  const [savedKeys, setSavedKeys] = useState<Array<{ id: string; name: string }>>([]);
  const [byotKeyId, setByotKeyId] = useState("");
  const [keyName, setKeyName] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keysLoading, setKeysLoading] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [configureInbound, setConfigureInbound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
    setByotKeyId("");
    setCustomKey(false);
    setKeyName("");
    setKeyError(null);
    setCallerIdMode("account");
    setConfigureInbound(false);
  }, [selected, outbound]);

  const sameAgent = inbound === outbound;
  const bothTesting = inboundParsed.kind === "testing" && parse(outbound).kind === "testing";
  const bothTarget = inboundParsed.kind === "target" && parse(outbound).kind === "target";
  const chosenTesting = testingAgents.find((a) => a.id === (inboundParsed.kind === "testing" ? inboundParsed.id : outboundParsed.id));
  const accountMismatch = Boolean(chosenTesting && chosenTesting.accountId !== selected);
  const invalidPair = sameAgent || bothTesting || bothTarget || accountMismatch;
  const selectedAccount = accounts.find((a) => a.id === selected);
  const isBland = selectedAccount?.provider === "bland";
  const outboundIsTarget = outboundParsed.kind === "target";
  const caller = outboundIsTarget
    ? targets.find((a) => a.id === outboundParsed.id)
    : testingAgents.find((a) => a.id === outboundParsed.id);
  const callerPathwayId = outboundIsTarget ? caller?.externalAgentId
    : chosenTesting && (chosenTesting.imported || chosenTesting.spec?.structured || chosenTesting.spec?.steps?.length || chosenTesting.spec?.pathwayId)
      ? chosenTesting.externalAgentId : undefined;
  const callerSavedKey = savedKeys.find((key) => key.id === caller?.byotKeyId);
  const callerKeyError = caller?.byotKeyId
    ? caller.byotAccountId && caller.byotAccountId !== selected
      ? "This caller’s saved key belongs to a different account. Select its account or choose a key below."
      : !keysLoading && !keyError && !callerSavedKey
        ? "This caller’s saved key was removed. Edit the caller or choose another key below."
        : undefined
    : undefined;
  const defaultKeyLabel = caller?.byotKeyId
    ? `${callerSavedKey?.name ?? "Saved key"} — ${caller.name}`
    : caller?.hasEncryptedKey
      ? `•••••••• — saved on ${caller.name}`
      : "Use provider account default";

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
      setSavedKeys((keys) => [...keys, data.key]); setByotKeyId(data.key.id); setCustomKey(false); setEncryptedKey(""); setKeyName("");
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
      if (!data.result?.id) throw new Error("The call started, but HAL did not return a result page.");
      setEncryptedKey("");
      setCustomKey(false);
      router.push(`/results/${encodeURIComponent(data.result.id)}`);
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
          <button className={mode === "chat" ? "active" : "secondary"} aria-pressed={mode === "chat"} disabled={busy} onClick={() => setMode("chat")}>Chat</button>
        </div>
      </div>
      {mode === "chat" ? <HostedChatRun testCaseId={testCaseId} /> : accounts.length === 0 ? <p className="muted">Connect an account on <Link href="/agents">Providers</Link> to place a call.</p> : <>
        <label className="field account-picker"><span className="field-label">Provider account</span>
          <select disabled={busy || keyBusy || keysLoading} value={selected} onChange={(e) => { setAccountId(e.target.value); if (inboundParsed.kind === "testing") { setInbound(AUTO); setPhone(""); } if (outboundParsed.kind === "testing") setOutbound(AUTO); }}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.provider})</option>)}
          </select>
        </label>
        <fieldset disabled={busy || keyBusy} className="scenario-fields">
          <div className="call-participants">
            <section className="participant-panel"><div className="section-heading"><h4>Caller</h4><span className="pill outbound">Outbound</span></div>
              <label className="field"><span className="field-label">Agent placing the call</span><select value={outbound} onChange={(e) => setOutbound(e.target.value as AgentValue)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
              {isBland && <p className="field-help">{callerPathwayId
                ? <>Bland pathway sent with this call: <span className="mono">{callerPathwayId}</span></>
                : chosenTesting ? "This saved tester uses a task prompt, not a Bland pathway."
                  : "Auto creates a new Bland pathway from this simulation’s script for the call."}</p>}
              <label className="field"><span className="field-label">Caller ID</span><select value={callerIdMode} onChange={(e) => setCallerIdMode(e.target.value)}><option value="account">Account default</option>{isBland && <option value="pool">Bland default pool</option>}<option value="custom">Choose a number</option></select></label>
              {callerIdMode === "custom" && <NumberPicker accountId={selected} value={fromPhone} onChange={setFromPhone} ariaLabel="Outbound caller ID" placeholder="+14155550123" />}
              <p className="field-help">{isBland ? "Use a number owned by this account, including + and country code." : "Vapi and ElevenLabs use the number ID saved on the account."}</p>
              {isBland && callerIdMode !== "pool" && <div className="caller-credentials">
                <label className="field"><span className="field-label">Twilio encrypted key</span>
                  <select disabled={keysLoading} value={byotKeyId || (customKey ? "__custom__" : "")} onChange={(e) => { setByotKeyId(e.target.value === "__custom__" ? "" : e.target.value); setCustomKey(e.target.value === "__custom__"); setEncryptedKey(""); setKeyName(""); }}>
                    <option value="">{defaultKeyLabel}</option>
                    {savedKeys.map((key) => <option key={key.id} value={key.id}>{key.name}</option>)}
                    <option value="__custom__">Enter a key for this call</option>
                  </select>
                </label>
                {!byotKeyId && !customKey && <p className="field-help">{caller?.byotKeyId || caller?.hasEncryptedKey ? `Loaded from ${caller.name}. Used automatically when this agent calls outbound.` : "Uses the provider account’s default key, if configured."}</p>}
                {!byotKeyId && !customKey && callerKeyError && <p role="alert" className="error-text">{callerKeyError}</p>}
                {customKey && <>
                  <label className="field"><span className="field-label">Key for this call</span><input type={credentialsVisible ? "text" : "password"} autoComplete="off" spellCheck={false} value={encryptedKey} onChange={(e) => setEncryptedKey(e.target.value)} placeholder="Paste the BYOT encrypted key" /></label>
                  <label className="field"><span className="field-label">Name for reuse (optional)</span><input maxLength={120} value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="e.g. Main Twilio" /></label>
                  <button type="button" className="secondary" onClick={saveKey} disabled={keysLoading || !encryptedKey.trim() || !keyName.trim()}>{keyBusy ? "Saving…" : "Save key"}</button>
                </>}
                {byotKeyId && <button type="button" className="secondary" onClick={removeKey}>Remove saved key</button>}
                {keyError && <p role="alert" className="error-text">{keyError}</p>}
              </div>}
              {isBland && callerIdMode === "pool" && <p className="field-help">Bland’s default pool does not use a Twilio key.</p>}
            </section>
            <section className="participant-panel"><div className="section-heading"><h4>Receiver</h4><span className="pill inbound">Inbound</span></div>
              <label className="field"><span className="field-label">Agent answering the call</span><select value={inbound} onChange={(e) => setInbound(e.target.value as AgentValue)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
              <div className="field"><span className="field-label">Destination number</span><NumberPicker accountId={selected} value={phone} onChange={setPhone} ariaLabel="Inbound destination number" placeholder="+14155550123" /></div>
              <p className="field-help">The number the caller will dial.</p>
            </section>
          </div>
          {chosenTesting && <p className="field-help">HAL applies this simulation’s script and personality to the selected tester before the call. Its provider graph keeps the new script afterward. This simulation’s judges score the call.</p>}
          {outboundIsTarget && <label className="confirmation-row"><input type="checkbox" checked={configureInbound} onChange={(e) => setConfigureInbound(e.target.checked)} /><span>Configure the dedicated receiving test number with {chosenTesting?.imported ? "the imported tester’s pathway" : "this scenario"}. This replaces its current pathway and stays set after the run.</span></label>}
          {invalidPair && <p role="alert" className="error-text">Choose one testing agent from this account and one agent under test.</p>}
        </fieldset>
        <div className="action-bar"><span className="field-help">{chosenTesting ? "Updates the selected testing agent with this simulation." : "Creates a tester from the saved scenario."} This places a real phone call.</span><button onClick={dispatch} disabled={busy || keyBusy || keysLoading || !phone.trim() || invalidPair || (callerIdMode === "custom" && !fromPhone.trim()) || (outboundIsTarget && !configureInbound)}>{busy ? "Placing call…" : "Place test call"}</button></div>
      </>}
      {mode === "call" && err && <div className="muted" style={{ color: "var(--fail)", marginTop: 8 }}>{err}</div>}
    </div>
  );
}
