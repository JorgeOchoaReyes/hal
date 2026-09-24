"use client";

import { useCallback, useEffect, useState } from "react";
import type { SavedJudge, JudgeRule, JudgeSpec, Role } from "@hal/core";
import Modal from "./Modal";

const RULE_TYPES: Array<{ value: JudgeRule["kind"]; label: string }> = [
  { value: "transcript-contains", label: "Transcript contains" },
  { value: "transcript-not-contains", label: "Transcript must NOT contain" },
  { value: "regex", label: "Matches regex" },
  { value: "max-latency", label: "Max latency (ms)" },
  { value: "min-turns", label: "Min turns" },
  { value: "max-turns", label: "Max turns" },
];

const KIND_TONE: Record<SavedJudge["kind"], string> = { llm: "info", code: "neutral", hybrid: "warn" };

function ruleSummary(r: JudgeRule): string {
  switch (r.kind) {
    case "transcript-contains":
      return `contains "${r.needle}"`;
    case "transcript-not-contains":
      return `must not contain "${r.needle}"`;
    case "regex":
      return `/${r.pattern}/${r.role ? ` on ${r.role}` : ""}`;
    case "max-latency":
      return `${r.role ?? "any"} latency ≤ ${r.ms}ms`;
    case "min-turns":
      return `≥ ${r.count} turns`;
    case "max-turns":
      return `≤ ${r.count} turns`;
  }
}

export default function JudgesManager() {
  const [judges, setJudges] = useState<SavedJudge[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<SavedJudge | "new" | null>(null);

  const refresh = useCallback(async () => {
    const d = await fetch("/api/judges").then((r) => r.json());
    setJudges(d.judges ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoaded(true));
  }, [refresh]);

  async function remove(id: string) {
    await fetch(`/api/judges/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <>
      <div className="toolbar" style={{ margin: "4px 0 0" }}>
        <div className="muted" style={{ fontSize: 13 }}>
          {judges.length} judge{judges.length === 1 ? "" : "s"}
        </div>
        <button onClick={() => setEditing("new")}>+ New judge</button>
      </div>

      {loaded && judges.length === 0 && (
        <div className="card muted">
          No judges yet. Create one to score simulations and uploaded production calls with LLM
          criteria, deterministic code checks, or both.
        </div>
      )}

      <div className="grid stagger" style={{ gap: 10 }}>
        {judges.map((j) => (
          <div className="card" key={j.id} style={{ marginBottom: 0 }}>
            <div className="card-row">
              <div>
                <strong>{j.name}</strong>{" "}
                <span className={`label label-${KIND_TONE[j.kind]}`}>{j.kind}</span>
                {j.description && (
                  <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                    {j.description}
                  </div>
                )}
              </div>
              <div className="row-actions">
                <button className="icon-btn" onClick={() => setEditing(j)}>
                  Edit
                </button>
                <button className="icon-btn" onClick={() => remove(j.id)}>
                  Delete
                </button>
              </div>
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(j.spec.criteria ?? []).map((c, i) => (
                <span key={`c${i}`} className="tag" title="LLM criterion">
                  ⚖︎ {c.length > 40 ? c.slice(0, 40) + "…" : c}
                </span>
              ))}
              {(j.spec.rules ?? []).map((r, i) => (
                <span key={`r${i}`} className="tag mono" title="Code check">
                  ▸ {ruleSummary(r)}
                </span>
              ))}
              {(j.spec.criteria?.length ?? 0) === 0 && (j.spec.rules?.length ?? 0) === 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  No checks defined.
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <JudgeEditor
          judge={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

function JudgeEditor({
  judge,
  onClose,
  onSaved,
}: {
  judge: SavedJudge | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(judge?.name ?? "");
  const [description, setDescription] = useState(judge?.description ?? "");
  const [mode, setMode] = useState<NonNullable<JudgeSpec["mode"]>>(judge?.spec.mode ?? "all");
  const [provider, setProvider] = useState<NonNullable<JudgeSpec["provider"]>>(judge?.spec.provider ?? "auto");
  const [model, setModel] = useState(judge?.spec.model ?? "");
  const [criteria, setCriteria] = useState<string[]>(judge?.spec.criteria ?? [""]);
  const [rules, setRules] = useState<JudgeRule[]>(judge?.spec.rules ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function addRule() {
    setRules((rs) => [...rs, { kind: "transcript-contains", needle: "" } as JudgeRule]);
  }
  function updateRule(i: number, next: JudgeRule) {
    setRules((rs) => rs.map((r, idx) => (idx === i ? next : r)));
  }
  function removeRule(i: number) {
    setRules((rs) => rs.filter((_, idx) => idx !== i));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const spec: JudgeSpec = {
        mode,
        provider,
        model: model.trim() || undefined,
        criteria: criteria.map((c) => c.trim()).filter(Boolean),
        rules,
      };
      const res = await fetch(judge ? `/api/judges/${judge.id}` : "/api/judges", {
        method: judge ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description, spec }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={judge ? `Edit judge — ${judge.name}` : "New judge"}
      footer={
        <>
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button onClick={save} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Save judge"}
          </button>
        </>
      }
    >
      {err && (
        <div className="muted" style={{ color: "var(--fail)", marginBottom: 8 }}>
          {err}
        </div>
      )}
      <label className="field">
        <span className="field-label">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Booking accuracy" />
      </label>
      <label className="field">
        <span className="field-label">Description</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this judge evaluates"
        />
      </label>

      <h2 style={{ fontSize: 14, marginBottom: 6 }}>LLM criteria</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Natural-language pass conditions an LLM judge evaluates against the call.
      </p>
      {criteria.map((c, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input
            value={c}
            onChange={(e) => setCriteria((cs) => cs.map((x, idx) => (idx === i ? e.target.value : x)))}
            placeholder="The agent confirmed the appointment date and time."
          />
          <button
            type="button"
            className="icon-btn"
            onClick={() => setCriteria((cs) => cs.filter((_, idx) => idx !== i))}
            title="Remove"
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="secondary sm" onClick={() => setCriteria((cs) => [...cs, ""])}>
        + Add criterion
      </button>

      <h2 style={{ fontSize: 14, margin: "18px 0 6px" }}>Code checks</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Deterministic rules evaluated without an LLM — fast and free.
      </p>
      {rules.map((r, i) => (
        <RuleRow key={i} rule={r} onChange={(next) => updateRule(i, next)} onRemove={() => removeRule(i)} />
      ))}
      <button type="button" className="secondary sm" onClick={addRule}>
        + Add code check
      </button>

      <h2 style={{ fontSize: 14, margin: "18px 0 6px" }}>Scoring</h2>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          <span className="field-label">Combine mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="all">All — rules AND LLM must pass</option>
            <option value="rules-only">Rules only — ignore LLM</option>
            <option value="llm-only">LLM only — ignore rules</option>
          </select>
        </label>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          <span className="field-label">LLM provider</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
            <option value="auto">Auto — first configured</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="gemini">Google Gemini</option>
          </select>
        </label>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          <span className="field-label">LLM model (optional)</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="default" />
        </label>
      </div>
    </Modal>
  );
}

function RuleRow({
  rule,
  onChange,
  onRemove,
}: {
  rule: JudgeRule;
  onChange: (r: JudgeRule) => void;
  onRemove: () => void;
}) {
  function setKind(kind: JudgeRule["kind"]) {
    switch (kind) {
      case "transcript-contains":
      case "transcript-not-contains":
        onChange({ kind, needle: "" });
        break;
      case "regex":
        onChange({ kind, pattern: "" });
        break;
      case "max-latency":
        onChange({ kind, ms: 3000 });
        break;
      case "min-turns":
        onChange({ kind, count: 2 });
        break;
      case "max-turns":
        onChange({ kind, count: 20 });
        break;
    }
  }

  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center", flexWrap: "wrap" }}>
      <select
        value={rule.kind}
        onChange={(e) => setKind(e.target.value as JudgeRule["kind"])}
        style={{ width: 220 }}
      >
        {RULE_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      {(rule.kind === "transcript-contains" || rule.kind === "transcript-not-contains") && (
        <input
          style={{ flex: 1, minWidth: 160 }}
          value={rule.needle}
          onChange={(e) => onChange({ ...rule, needle: e.target.value })}
          placeholder="text to look for"
        />
      )}
      {rule.kind === "regex" && (
        <>
          <input
            style={{ flex: 1, minWidth: 140 }}
            className="mono"
            value={rule.pattern}
            onChange={(e) => onChange({ ...rule, pattern: e.target.value })}
            placeholder="pattern"
          />
          <select
            value={rule.role ?? ""}
            onChange={(e) => onChange({ ...rule, role: (e.target.value || undefined) as Role | undefined })}
            style={{ width: 130 }}
          >
            <option value="">any role</option>
            <option value="agent">agent</option>
            <option value="target">target</option>
          </select>
        </>
      )}
      {rule.kind === "max-latency" && (
        <input
          type="number"
          style={{ width: 120 }}
          value={rule.ms}
          onChange={(e) => onChange({ ...rule, ms: Number(e.target.value) })}
        />
      )}
      {(rule.kind === "min-turns" || rule.kind === "max-turns") && (
        <input
          type="number"
          style={{ width: 120 }}
          value={rule.count}
          onChange={(e) => onChange({ ...rule, count: Number(e.target.value) })}
        />
      )}

      <button type="button" className="icon-btn" onClick={onRemove} title="Remove">
        ✕
      </button>
    </div>
  );
}
