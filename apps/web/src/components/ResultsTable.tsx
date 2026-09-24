"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface ResultRow {
  id: string;
  testCaseId: string;
  simName: string;
  transport: string;
  status: string;
  startedAt: number;
  durationMs?: number;
  turns: number;
  score?: number;
  labels: { text: string; tone: string }[];
  /** Free-text label the run was given (e.g. a batch run's name), if any. */
  runLabel?: string;
}

/**
 * Every run across every simulation, newest first — the audit trail of the lab.
 * One row per {@link ResultRow}, linking back into the simulation it ran against.
 */
export default function ResultsTable({ rows }: { rows: ResultRow[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");

  const statuses = useMemo(
    () => ["all", ...Array.from(new Set(rows.map((r) => r.status)))],
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (!needle) return true;
      return (
        r.simName.toLowerCase().includes(needle) ||
        r.testCaseId.toLowerCase().includes(needle) ||
        r.id.toLowerCase().includes(needle) ||
        r.status.toLowerCase().includes(needle) ||
        (r.runLabel?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [rows, q, status]);

  return (
    <>
      <div className="toolbar">
        <input
          className="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search runs by simulation, id, status, or label…"
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {statuses.map((s) => (
            <button
              key={s}
              className={`icon-btn${status === s ? " active" : ""}`}
              onClick={() => setStatus(s)}
              style={status === s ? { fontWeight: 600 } : undefined}
            >
              {s}
            </button>
          ))}
          <span className="muted" style={{ fontSize: 13 }}>
            {filtered.length} of {rows.length}
          </span>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 170 }}>When</th>
              <th>Simulation</th>
              <th>Run label</th>
              <th>Channel</th>
              <th style={{ width: 110 }}>Status</th>
              <th style={{ width: 70, textAlign: "center" }}>Turns</th>
              <th style={{ width: 80, textAlign: "center" }}>Score</th>
              <th>Labels</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr className="empty-row">
                <td colSpan={8}>
                  {rows.length === 0
                    ? "No runs yet — run a simulation to see results here."
                    : "No runs match your filter."}
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id}>
                <td className="muted" style={{ fontSize: 13 }}>
                  {new Date(r.startedAt).toLocaleString()}
                </td>
                <td>
                  <Link href={`/simulations/${r.testCaseId}`} style={{ fontWeight: 600 }}>
                    {r.simName}
                  </Link>
                </td>
                <td className="muted mono" style={{ fontSize: 12 }}>
                  {r.runLabel ?? "—"}
                </td>
                <td>
                  <span className={`pill ${r.transport}`}>{r.transport}</span>
                </td>
                <td>
                  <span className={`pill ${r.status}`}>{r.status}</span>
                </td>
                <td style={{ textAlign: "center" }}>
                  <span className="count-badge">{r.turns}</span>
                </td>
                <td style={{ textAlign: "center" }} className="muted">
                  {r.score == null ? "—" : `${Math.round(r.score * 100)}%`}
                </td>
                <td>
                  {r.labels.length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    r.labels.map((l, i) => (
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
  );
}
