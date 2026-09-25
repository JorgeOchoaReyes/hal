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
  direction?: "inbound" | "outbound";
  target: { transport: string; phoneNumber?: string };
}
interface TestCaseLite {
  targetAgentId?: string;
  testingAgentId?: string;
}

/**
 * Ad-hoc dispatch of any simulation (steps or structured) to a hosted provider:
 * HAL compiles it into that platform's native agent config at dispatch time —
 * this is where "how to run it" is actually decided, not at creation — creates
 * (or reconfigures) the testing agent to match this simulation's current
 * persona/scenario, places the call, waits for it to finish, and pulls the
 * judged result from the provider.
 */
export default function DispatchHosted({ testCaseId }: { testCaseId: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [testingAgents, setTestingAgents] = useState<TestingAgentLite[]>([]);
  const [testingAgentId, setTestingAgentId] = useState("");
  const [targets, setTargets] = useState<TargetAgentLite[]>([]);
  const [targetAgentId, setTargetAgentId] = useState("");
  const [direction, setDirection] = useState<"inbound" | "outbound">("inbound");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: string; labels?: Array<{ text: string; tone: string }> } | null>(null);

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
        setTestingAgentId(tc.testingAgentId ?? "");
        if (tc.targetAgentId) setTargetAgentId(tc.targetAgentId);
      })
      .catch(() => undefined);
  }, [testCaseId]);

  const selected = accountId || accounts[0]?.id || "";
  const selectedTarget = targets.find((t) => t.id === targetAgentId);

  // Picking a saved agent under test (or loading the simulation's own default)
  // defaults the direction to that agent's own, and — for inbound — auto-fills
  // its number. Both stay editable afterward.
  useEffect(() => {
    if (!targetAgentId) return;
    const agent = targets.find((t) => t.id === targetAgentId);
    if (!agent) return;
    setDirection(agent.direction ?? "inbound");
    if ((agent.direction ?? "inbound") === "inbound" && agent.target.phoneNumber) {
      setPhone(agent.target.phoneNumber);
    }
  }, [targetAgentId, targets]);

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
          testingAgentId: testingAgentId || undefined,
          direction,
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
        Dispatch this simulation to a hosted platform. HAL reconfigures the chosen testing agent
        to match this simulation&apos;s current persona/scenario, places the call, and judges the
        result.
      </p>
      {accounts.length === 0 ? (
        <p className="muted">
          No provider accounts yet — connect one on <a href="/agents">Hosted agents</a>.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select value={selected} onChange={(e) => setAccountId(e.target.value)} style={{ width: "auto" }}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} ({a.provider})
                </option>
              ))}
            </select>
            <select
              value={testingAgentId}
              onChange={(e) => setTestingAgentId(e.target.value)}
              style={{ width: "auto" }}
              title="The testing agent (the caller) — reconfigured to match this simulation before the call"
            >
              <option value="">Testing agent: Auto — provision ad-hoc</option>
              {testingAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  Testing agent: {a.name} ({a.provider})
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={targetAgentId}
              onChange={(e) => setTargetAgentId(e.target.value)}
              style={{ width: "auto" }}
              title="Pick a saved agent under test to fill in its number and direction"
            >
              <option value="">Agent under test: manual number</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  Agent under test: {t.name}
                </option>
              ))}
            </select>
            <span className={`pill ${direction}`} title="Which side places the call for this dispatch">
              {direction}
            </span>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as "inbound" | "outbound")}
              style={{ width: "auto" }}
              title="Which side places the call for this dispatch"
            >
              <option value="inbound">Direction: Inbound — testing agent calls agent under test</option>
              <option value="outbound">Direction: Outbound — agent under test calls testing agent</option>
            </select>
            <NumberPicker
              accountId={selected}
              value={phone}
              onChange={setPhone}
              placeholder={direction === "outbound" ? "+14155550123 (testing agent)" : "+14155550123 (target)"}
            />
            <button onClick={dispatch} disabled={busy || !phone.trim() || (direction === "outbound" && !targetAgentId)}>
              {busy ? "Dispatching…" : "Dispatch to provider"}
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            {direction === "inbound"
              ? "Inbound: the testing agent dials the number above (the agent under test)."
              : selectedTarget
                ? `Outbound: "${selectedTarget.name}" places the call from its own pathway to the number above — its own number, already wired to answer via the testing agent's pathway on the provider.`
                : "Outbound: the agent under test places the call — pick a saved agent under test above (it needs its own pathway id and key set)."}
          </p>
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
