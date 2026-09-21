"use client";

import { useCallback, useRef, useState } from "react";
import type { RunEvent, Utterance, CheckResult, JudgeVerdict, RunStatus } from "@hal/core";

interface LogLine {
  level: string;
  message: string;
}

export default function RunPanel({ testCaseId }: { testCaseId: string }) {
  const [status, setStatus] = useState<RunStatus | "idle">("idle");
  const [transcript, setTranscript] = useState<Utterance[]>([]);
  const [liveChecks, setLiveChecks] = useState<CheckResult[]>([]);
  const [verdict, setVerdict] = useState<JudgeVerdict | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const start = useCallback(() => {
    esRef.current?.close();
    setStatus("running");
    setTranscript([]);
    setLiveChecks([]);
    setVerdict(null);
    setLogs([]);

    const es = new EventSource(`/api/run?testCaseId=${encodeURIComponent(testCaseId)}`);
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
        case "log":
          setLogs((l) => [...l, { level: event.level, message: event.message }]);
          break;
        case "done":
          setStatus(event.result.status);
          break;
      }
    };
    es.addEventListener("end", () => es.close());
    es.onerror = () => es.close();
  }, [testCaseId]);

  const running = status === "running";

  return (
    <div>
      <div className="card-row" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={start} disabled={running}>
            {running ? "Running…" : "▶ Run test call"}
          </button>
          {status !== "idle" && <span className={`pill ${status}`}>{status}</span>}
        </div>
      </div>

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

      {verdict && <VerdictCard verdict={verdict} />}

      {logs.length > 0 && (
        <>
          <h2>Log</h2>
          <div className="card">
            {logs.map((l, i) => (
              <div className="log" key={i}>
                [{l.level}] {l.message}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
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
      </div>
    </>
  );
}
