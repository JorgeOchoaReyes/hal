"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SavedJudge } from "@hal/core";

const KIND_TONE: Record<SavedJudge["kind"], string> = { llm: "info", code: "neutral", hybrid: "warn" };

/**
 * Attach/detach reusable judges on a simulation. Persists each change via
 * PATCH /api/testcases/[id]; those judges are merged into the run's scoring.
 */
export default function AttachJudges({
  testCaseId,
  initial,
}: {
  testCaseId: string;
  initial: string[];
}) {
  const [judges, setJudges] = useState<SavedJudge[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/judges")
      .then((r) => r.json())
      .then((d: { judges: SavedJudge[] }) => setJudges(d.judges ?? []))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  async function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    setSaving(true);
    try {
      await fetch(`/api/testcases/${testCaseId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ judgeIds: [...next] }),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="card-row">
        <strong>Judges</strong>
        {saving ? (
          <span className="muted" style={{ fontSize: 12 }}>
            saving…
          </span>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>
            {selected.size} attached
          </span>
        )}
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
        Reusable judges applied on top of this simulation&apos;s own pass criteria when it runs.
      </p>
      {loaded && judges.length === 0 && (
        <p className="muted" style={{ marginBottom: 0 }}>
          No judges yet — create one on the <Link href="/judges">Judges</Link> page.
        </p>
      )}
      <div className="grid" style={{ gap: 6, marginTop: 6 }}>
        {judges.map((j) => (
          <label
            key={j.id}
            className="card-row"
            style={{
              cursor: "pointer",
              background: "var(--panel-2)",
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
            }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={selected.has(j.id)}
                onChange={() => toggle(j.id)}
              />
              <span>
                <strong>{j.name}</strong>{" "}
                <span className={`label label-${KIND_TONE[j.kind]}`}>{j.kind}</span>
                {j.description && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    {j.description}
                  </div>
                )}
              </span>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
