"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { RunStatus } from "@hal/core";
import { useNewSimulation } from "./NewSimulationContext";
import RunModal from "./RunModal";

export interface SimRow {
  id: string;
  name: string;
  persona: string;
  transport: string;
  target: string;
  steps: number;
  metrics: number;
  tags: string[];
}

type RunState = "idle" | RunStatus;

/**
 * A clean, tabular list of simulations — one row per scenario with its persona,
 * channel, target, step/metric counts, tags, and inline run. Modeled on a
 * conventional evaluators table so scanning many scenarios is fast.
 */
export default function SimulationsTable({ rows }: { rows: SimRow[] }) {
  const [q, setQ] = useState("");
  const [runState, setRunState] = useState<Record<string, RunState>>({});
  const [runModalFor, setRunModalFor] = useState<string | null>(null);
  const { openNewSimulation } = useNewSimulation();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        r.id.toLowerCase().includes(needle) ||
        r.persona.toLowerCase().includes(needle) ||
        r.tags.some((t) => t.toLowerCase().includes(needle)),
    );
  }, [rows, q]);

  function onRunComplete(id: string, status: RunStatus) {
    setRunState((s) => ({ ...s, [id]: status }));
  }

  return (
    <>
      <div className="toolbar">
        <input
          className="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search scenarios by name, id, persona, or tag…"
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {filtered.length} of {rows.length}
          </span>
          <button type="button" className="btn" onClick={() => openNewSimulation()}>
            + New simulation
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 92 }}>ID</th>
              <th>Name</th>
              <th>Persona</th>
              <th>Channel</th>
              <th>Target</th>
              <th style={{ width: 70, textAlign: "center" }}>Steps</th>
              <th style={{ width: 80, textAlign: "center" }}>Metrics</th>
              <th>Tags</th>
              <th style={{ width: 150, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr className="empty-row">
                <td colSpan={9}>
                  {rows.length === 0 ? "No simulations yet." : "No scenarios match your search."}
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const state = runState[r.id] ?? "idle";
              return (
                <tr key={r.id}>
                  <td className="id-cell">{r.id.slice(0, 8)}</td>
                  <td>
                    <Link href={`/simulations/${r.id}`} style={{ fontWeight: 600 }}>
                      {r.name}
                    </Link>
                  </td>
                  <td className="muted">{r.persona}</td>
                  <td>
                    <span className={`pill ${r.transport}`}>{r.transport}</span>
                  </td>
                  <td className="muted mono" style={{ fontSize: 12 }}>
                    {r.target || "—"}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <span className="count-badge">{r.steps}</span>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <span className="count-badge">{r.metrics}</span>
                  </td>
                  <td>
                    {r.tags.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      r.tags.map((t) => (
                        <span className="tag" key={t}>
                          {t}
                        </span>
                      ))
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="icon-btn"
                        onClick={() => setRunModalFor(r.id)}
                        title="Configure and run this simulation"
                      >
                        ▶ Run
                      </button>
                      {state !== "idle" && <span className={`pill ${state}`}>{state}</span>}
                      <Link href={`/simulations/${r.id}`} className="icon-btn" title="Open">
                        Open
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {runModalFor && (
        <RunModal
          testCaseId={runModalFor}
          onClose={() => setRunModalFor(null)}
          onRunComplete={(status) => onRunComplete(runModalFor, status)}
        />
      )}
    </>
  );
}
