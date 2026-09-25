"use client";

import { useEffect, useState } from "react";
import NumberPicker from "./NumberPicker";

interface Account {
  id: string;
  provider: string;
  label: string;
}
interface TestingAgentLite {
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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [testingAgents, setTestingAgents] = useState<TestingAgentLite[]>([]);
  const [targets, setTargets] = useState<TargetAgentLite[]>([]);
  const [inbound, setInbound] = useState<AgentValue>("target:");
  const [outbound, setOutbound] = useState<AgentValue>(AUTO);
  const [phone, setPhone] = useState("");
  const [fromPhone, setFromPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{
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
    ...testingAgents.map((a): { value: AgentValue; label: string } => ({
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
  const outboundTarget = outboundParsed.kind === "target" ? targets.find((t) => t.id === outboundParsed.id) : undefined;

  // The phone field is always the INBOUND agent's own number — the one the
  // outbound side dials. The from-number field is the OUTBOUND agent's own
  // number — its caller id for the call. Picking a saved agent under test
  // for either side auto-fills its stored number; both stay editable.
  useEffect(() => {
    if (inboundTarget?.target.phoneNumber) setPhone(inboundTarget.target.phoneNumber);
  }, [inboundTarget]);
  useEffect(() => {
    setFromPhone(outboundTarget?.target.phoneNumber ?? "");
  }, [outboundTarget]);

  const sameAgent = inbound === outbound;
  const bothTesting = inboundParsed.kind === "testing" && parse(outbound).kind === "testing";
  const bothTarget = inboundParsed.kind === "target" && parse(outbound).kind === "target";
  const invalidPair = sameAgent || bothTesting || bothTarget;

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
          fromNumber: fromPhone.trim() || undefined,
          inboundAgent: parse(inbound),
          outboundAgent: parse(outbound),
        }),
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
        Dispatch this simulation to a hosted platform. Pick which agent waits (inbound) and which
        one places the call (outbound) — one side must be a testing agent, HAL reconfigures it to
        match this simulation&apos;s current persona/scenario before the call and judges the result.
      </p>
      {accounts.length === 0 ? (
        <p className="muted">
          No provider accounts yet — connect one on <a href="/agents">Hosted agents</a>.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label className="field" style={{ margin: 0, width: "auto" }}>
              <span className="field-label">Provider account</span>
              <select value={selected} onChange={(e) => setAccountId(e.target.value)} style={{ width: "auto" }}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} ({a.provider})
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ margin: 0, width: "auto" }}>
              <span className="field-label">
                Inbound <span className="pill inbound" style={{ marginLeft: 4 }}>waits</span>
              </span>
              <select
                value={inbound}
                onChange={(e) => setInbound(e.target.value as AgentValue)}
                style={{ width: "auto" }}
                title="The agent that waits and answers the call"
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ margin: 0, width: "auto" }}>
              <span className="field-label">
                Outbound <span className="pill outbound" style={{ marginLeft: 4 }}>calls</span>
              </span>
              <select
                value={outbound}
                onChange={(e) => setOutbound(e.target.value as AgentValue)}
                style={{ width: "auto" }}
                title="The agent that places the call"
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="field" style={{ margin: 0, width: "auto" }}>
              <span className="field-label">Inbound agent&apos;s number</span>
              <NumberPicker
                accountId={selected}
                value={phone}
                onChange={setPhone}
                placeholder="+14155550123 (inbound agent)"
              />
            </label>
            <label className="field" style={{ margin: 0, width: "auto" }}>
              <span className="field-label">Outbound agent&apos;s number (optional)</span>
              <NumberPicker
                accountId={selected}
                value={fromPhone}
                onChange={setFromPhone}
                placeholder="+14155550123 (outbound agent)"
              />
            </label>
            <button onClick={dispatch} disabled={busy || !phone.trim() || invalidPair}>
              {busy ? "Dispatching…" : "Dispatch to provider"}
            </button>
          </div>
          {invalidPair && (
            <p className="muted" style={{ fontSize: 12, margin: 0, color: "var(--fail)" }}>
              Pick one testing agent and one agent under test — one for each side.
            </p>
          )}
        </div>
      )}
      {err && <div className="muted" style={{ color: "var(--fail)", marginTop: 8 }}>{err}</div>}
      {result && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span className={`pill ${result.status}`}>{result.status}</span>
            {(result.labels ?? []).map((l, i) => (
              <span key={i} className={`label label-${l.tone}`}>{l.text}</span>
            ))}
            {result.externalCallId && (
              <span className="muted mono" style={{ fontSize: 12 }}>
                call {result.externalCallId}
              </span>
            )}
          </div>
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
            <div className="transcript" style={{ marginTop: 8 }}>
              {result.transcript!.map((u, i) => (
                <div className={`turn ${u.role}`} key={i}>
                  <div className="who">{u.role}</div>
                  <div>{u.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
