"use client";

import { useEffect, useRef, useState } from "react";
import type {
  RunEvent,
  RunStatus,
  Utterance,
  CheckResult,
  JudgeVerdict,
  CallMetrics,
  Label,
  SavedJudge,
  TestResult,
} from "@hal/core";
import Modal from "./Modal";

interface TargetAgentLite {
  id: string;
  name: string;
  direction?: "inbound" | "outbound";
  target: { transport: string };
}

interface TestCaseLite {
  targetAgentId?: string;
  judgeIds?: string[];
}

type BatchEvent =
  | { type: "run-started"; index: number; total: number }
  | { type: "run-done"; index: number; total: number; result: TestResult }
  | { type: "batch-done" };

interface BatchRow {
  index: number;
  status: "queued" | RunStatus;
  score?: number;
  labels?: Label[];
}

export default function RunModal({
  testCaseId,
  onClose,
  onRunComplete,
}: {
  testCaseId: string;
  onClose: () => void;
  /** Called with each run's final status, e.g. so a table row can show it. */
  onRunComplete?: (status: RunStatus) => void;
}) {
  const [targets, setTargets] = useState<TargetAgentLite[]>([]);
  const [judges, setJudges] = useState<SavedJudge[]>([]);

  const [targetAgentId, setTargetAgentId] = useState(""); // "" = simulated (mock), as authored
  const [direction, setDirection] = useState<"inbound" | "outbound">("inbound");
  const [judgeIds, setJudgeIds] = useState<Set<string>>(new Set());
  const [label, setLabel] = useState("");
  const [count, setCount] = useState(1);
  const [mode, setMode] = useState<"sequential" | "parallel">("sequential");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Single-run (count === 1) live view.
  const [status, setStatus] = useState<"idle" | RunStatus>("idle");
  const [transcript, setTranscript] = useState<Utterance[]>([]);
  const [liveChecks, setLiveChecks] = useState<CheckResult[]>([]);
  const [verdict, setVerdict] = useState<JudgeVerdict | null>(null);
  const [metrics, setMetrics] = useState<CallMetrics | null>(null);
  const [resultLabels, setResultLabels] = useState<Label[]>([]);

  // Batch (count > 1) progress view.
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);

  const esRef = useRef<EventSource | null>(null);
  useEffect(() => () => esRef.current?.close(), []);

  useEffect(() => {
    fetch(`/api/testcases/${testCaseId}`)
      .then((r) => r.json())
      .then((d: { testCase?: TestCaseLite }) => {
        const tc = d.testCase;
        if (!tc) return;
        setTargetAgentId(tc.targetAgentId ?? "");
        setJudgeIds(new Set(tc.judgeIds ?? []));
      })
      .catch(() => undefined);
    fetch("/api/targets")
      .then((r) => r.json())
      .then((d: { targets?: TargetAgentLite[] }) => setTargets(d.targets ?? []))
      .catch(() => undefined);
    fetch("/api/judges")
      .then((r) => r.json())
      .then((d: { judges?: SavedJudge[] }) => setJudges(d.judges ?? []))
      .catch(() => undefined);
  }, [testCaseId]);

  // Default direction to the selected agent's own — still editable per run.
  useEffect(() => {
    if (!targetAgentId) {
      setDirection("inbound");
      return;
    }
    const agent = targets.find((t) => t.id === targetAgentId);
    setDirection(agent?.direction ?? "inbound");
  }, [targetAgentId, targets]);

  function toggleJudge(id: string) {
    setJudgeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const outboundBlocked = direction === "outbound";

  function buildParams(): URLSearchParams {
    const params = new URLSearchParams({ testCaseId, targetAgentId });
    params.set("judgeIds", [...judgeIds].join(","));
    if (label.trim()) params.set("label", label.trim());
    return params;
  }

  function start() {
    esRef.current?.close();
    setError(null);
    setBusy(true);
    setStatus("idle");
    setTranscript([]);
    setLiveChecks([]);
    setVerdict(null);
    setMetrics(null);
    setResultLabels([]);
    setBatchRows([]);

    const params = buildParams();

    if (count <= 1) {
      setStatus("running");
      const es = new EventSource(`/api/run?${params.toString()}`);
      esRef.current = es;
      es.onmessage = (e) => {
        const event = JSON.parse(e.data) as RunEvent;
        switch (event.type) {
          case "status":
            setStatus(event.status);
            break;
          case "utterance":
            setTranscript((t) => [...t, event.utterance]);
            break;
          case "live-check":
            setLiveChecks((c) => [...c, event.check]);
            break;
          case "verdict":
            setVerdict(event.verdict);
            break;
          case "done":
            setStatus(event.result.status);
            if (event.result.metrics) setMetrics(event.result.metrics);
            if (event.result.labels) setResultLabels(event.result.labels);
            setBusy(false);
            onRunComplete?.(event.result.status);
            break;
        }
      };
      es.addEventListener("end", () => es.close());
      es.onerror = () => {
        es.close();
        setBusy(false);
        setError("Run failed — check the server logs.");
      };
    } else {
      params.set("count", String(count));
      params.set("mode", mode);
      setBatchRows(Array.from({ length: count }, (_, i) => ({ index: i, status: "queued" })));
      const es = new EventSource(`/api/run-batch?${params.toString()}`);
      esRef.current = es;
      es.onmessage = (e) => {
        const event = JSON.parse(e.data) as BatchEvent;
        if (event.type === "run-started") {
          setBatchRows((rows) => rows.map((r) => (r.index === event.index ? { ...r, status: "running" } : r)));
        } else if (event.type === "run-done") {
          setBatchRows((rows) =>
            rows.map((r) =>
              r.index === event.index
                ? { ...r, status: event.result.status, score: event.result.verdict?.score, labels: event.result.labels }
                : r,
            ),
          );
          onRunComplete?.(event.result.status);
        } else if (event.type === "batch-done") {
          setBusy(false);
        }
      };
      es.addEventListener("end", () => es.close());
      es.onerror = () => {
        es.close();
        setBusy(false);
        setError("Batch run failed — check the server logs.");
      };
    }
  }

  const hasRun = status !== "idle" || batchRows.length > 0;

  return (
    <Modal open onClose={onClose} title="Run simulation" wide>
      {error && (
        <div className="card" style={{ borderColor: "var(--fail)", color: "var(--fail)", marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10 }}>
        <div className="field">
          <span className="field-label">Agent under test</span>
          <select value={targetAgentId} onChange={(e) => setTargetAgentId(e.target.value)} disabled={busy}>
            <option value="">Simulated (mock) — as authored</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.target.transport})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="field-label">Direction</span>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as "inbound" | "outbound")}
            disabled={busy}
          >
            <option value="inbound">inbound</option>
            <option value="outbound">outbound</option>
          </select>
        </div>
      </div>
      {outboundBlocked && (
        <p className="muted" style={{ color: "var(--fail)", fontSize: 12, marginTop: -4 }}>
          Outbound isn&apos;t supported yet — HAL can only dial an agent, not receive its call.
        </p>
      )}

      <div className="field">
        <span className="field-label">Judges (defaults to this simulation&apos;s attached judges)</span>
        {judges.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>No saved judges yet.</p>
        ) : (
          <div className="grid" style={{ gap: 6 }}>
            {judges.map((j) => (
              <label
                key={j.id}
                className="card-row"
                style={{ cursor: "pointer", background: "var(--panel-2)", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)" }}
              >
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    style={{ width: "auto" }}
                    checked={judgeIds.has(j.id)}
                    disabled={busy}
                    onChange={() => toggleJudge(j.id)}
                  />
                  <span>
                    <strong>{j.name}</strong> <span className="tag">{j.kind}</span>
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 160px", gap: 10 }}>
        <div className="field">
          <span className="field-label">Label (optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. regression-2026-09-24"
            disabled={busy}
          />
        </div>
        <div className="field">
          <span className="field-label">Times</span>
          <input
            type="number"
            min={1}
            max={20}
            value={count}
            onChange={(e) => setCount(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
            disabled={busy}
          />
        </div>
        <div className="field">
          <span className="field-label">Dispatch</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "sequential" | "parallel")}
            disabled={busy || count <= 1}
          >
            <option value="sequential">One at a time</option>
            <option value="parallel">All at once</option>
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
        <button onClick={start} disabled={busy || outboundBlocked}>
          {busy ? "Running…" : hasRun ? "Run again" : "Start run"}
        </button>
        {status !== "idle" && count <= 1 && <span className={`pill ${status}`}>{status}</span>}
      </div>

      {count <= 1 ? (
        <>
          {transcript.length > 0 && (
            <>
              <h2>Live transcript</h2>
              <div className="card">
                <div className="transcript">
                  {transcript.map((u, i) => (
                    <div className={`turn ${u.role}`} key={i}>
                      <div className="who">
                        {u.role}
                        {u.latencyMs != null && <span className="lat">{u.latencyMs}ms</span>}
                      </div>
                      <div>{u.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {liveChecks.length > 0 && (
            <>
              <h2>Live assertions</h2>
              <div className="card">
                <ul className="checks">
                  {liveChecks.map((c, i) => (
                    <li key={i} className={c.passed ? "pass" : "fail"}>
                      <span className="mark">{c.passed ? "✓" : "✗"}</span>
                      <span>
                        {c.description}
                        {c.detail && <div className="detail">{c.detail}</div>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {metrics && <MetricsCard metrics={metrics} labels={resultLabels} />}
          {verdict && <VerdictCard verdict={verdict} />}
        </>
      ) : (
        batchRows.length > 0 && (
          <>
            <h2>Batch progress</h2>
            <div className="card">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>#</th>
                    <th style={{ width: 110 }}>Status</th>
                    <th style={{ width: 80, textAlign: "center" }}>Score</th>
                    <th>Labels</th>
                  </tr>
                </thead>
                <tbody>
                  {batchRows.map((r) => (
                    <tr key={r.index}>
                      <td className="muted">{r.index + 1}</td>
                      <td>
                        <span className={`pill ${r.status}`}>{r.status}</span>
                      </td>
                      <td style={{ textAlign: "center" }} className="muted">
                        {r.score == null ? "—" : `${Math.round(r.score * 100)}%`}
                      </td>
                      <td>
                        {(r.labels ?? []).length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          r.labels!.map((l, i) => (
                            <span key={i} className={`label label-${l.tone}`}>
                              {l.text}
                            </span>
                          ))
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </Modal>
  );
}

function MetricsCard({ metrics, labels }: { metrics: CallMetrics; labels: Label[] }) {
  const tiles: Array<[string, string]> = [
    ["Score", `${Math.round(metrics.score * 100)}%`],
    ["Turns", String(metrics.totalTurns)],
    ["Duration", `${(metrics.durationMs / 1000).toFixed(1)}s`],
    ["Target p95 latency", metrics.targetLatency ? `${metrics.targetLatency.p95}ms` : "—"],
    ["Avg target words", String(metrics.avgTargetWords)],
    ["Live checks", `${Math.round(metrics.liveCheckPassRate * 100)}%`],
  ];
  return (
    <>
      <h2>Metrics</h2>
      <div className="card">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {labels.map((l, i) => (
            <span key={i} className={`label label-${l.tone}`}>{l.text}</span>
          ))}
        </div>
        <div className="metric-tiles">
          {tiles.map(([k, v]) => (
            <div className="metric-tile" key={k}>
              <div className="metric-value">{v}</div>
              <div className="metric-key">{k}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function VerdictCard({ verdict }: { verdict: JudgeVerdict }) {
  return (
    <>
      <h2>Judge verdict</h2>
      <div className="card">
        <div className="card-row">
          <strong style={{ fontSize: 16 }}>{verdict.summary}</strong>
          <span className={`pill ${verdict.passed ? "passed" : "failed"}`}>
            {verdict.passed ? "passed" : "failed"}
          </span>
        </div>
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          Score {Math.round(verdict.score * 100)}%
        </div>
        <div className="score-bar">
          <span style={{ width: `${Math.round(verdict.score * 100)}%` }} />
        </div>
        {verdict.checks.length > 0 && (
          <ul className="checks" style={{ marginTop: 12 }}>
            {verdict.checks.map((c, i) => (
              <li key={i} className={c.passed ? "pass" : "fail"}>
                <span className="mark">{c.passed ? "✓" : "✗"}</span>
                <span>
                  {c.description}
                  {c.detail && <div className="detail">{c.detail}</div>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {verdict.metricResults && verdict.metricResults.length > 0 && (
          <>
            <div className="field-label" style={{ marginTop: 14 }}>Metrics</div>
            <div className="metric-tiles">
              {verdict.metricResults.map((m, i) => (
                <div className="metric-tile" key={i}>
                  <div className="metric-value">{String(m.value)}</div>
                  <div className="metric-key">
                    {m.name}
                    {m.passed === true && <span className="label label-pass" style={{ marginLeft: 6 }}>pass</span>}
                    {m.passed === false && <span className="label label-fail" style={{ marginLeft: 6 }}>fail</span>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
