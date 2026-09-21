"use client";

import { useEffect, useState } from "react";
import type { ScenarioStep, JudgeRule, MetricDefinition, BranchAction } from "@hal/core";

interface ProviderView {
  id: string;
  label: string;
  transport: string;
  description: string;
  fields: Array<{ key: string; label: string; kind?: string; placeholder?: string; required?: boolean; help?: string; default?: string }>;
  requiresEnv: string[];
  available: boolean;
  missingEnv: string[];
}

export default function SimulationForm() {
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [providerId, setProviderId] = useState("mock");
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [targetConfig, setTargetConfig] = useState<Record<string, string>>({});
  const [personaName, setPersonaName] = useState("Everyday customer");
  const [personaPrompt, setPersonaPrompt] = useState(
    "You are a polite but busy customer calling a business. Answer questions directly.",
  );
  const [steps, setSteps] = useState<ScenarioStep[]>([
    { kind: "say", text: "Hi, I'd like some help please." },
  ]);
  const [criteria, setCriteria] = useState<string[]>([
    "The target stayed polite and on-topic.",
  ]);
  const [rules, setRules] = useState<JudgeRule[]>([{ kind: "min-turns", count: 3 }]);
  const [metrics, setMetrics] = useState<MetricDefinition[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((d) => {
        setProviders(d.providers);
        const mock = d.providers.find((p: ProviderView) => p.id === "mock");
        if (mock) applyDefaults(mock);
      })
      .catch(() => setError("Failed to load providers"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const provider = providers.find((p) => p.id === providerId);

  function applyDefaults(p: ProviderView) {
    const cfg: Record<string, string> = {};
    for (const f of p.fields) cfg[f.key] = f.default ?? "";
    setTargetConfig(cfg);
  }

  function selectProvider(pid: string) {
    setProviderId(pid);
    const p = providers.find((x) => x.id === pid);
    if (p) applyDefaults(p);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/simulations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          providerId,
          targetConfig,
          persona: { name: personaName, systemPrompt: personaPrompt },
          steps,
          judge: { mode: "all", rules, criteria: criteria.filter((c) => c.trim()), metrics },
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create");
      window.location.href = `/tests/${data.testCase.id}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 18 }}>
      {error && (
        <div className="card" style={{ borderColor: "var(--fail)", color: "var(--fail)" }}>
          {error}
        </div>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Basics</h2>
        <Field label="Simulation name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Booking — happy path" />
        </Field>
        <Field label="Tags (comma-separated)">
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="booking, smoke" />
        </Field>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Provider template</h2>
        <div className="provider-grid">
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`provider-chip ${p.id === providerId ? "active" : ""}`}
              onClick={() => selectProvider(p.id)}
            >
              <span className={`pill ${p.transport}`}>{p.transport}</span>
              <strong>{p.label}</strong>
              {!p.available && <span className="muted" style={{ fontSize: 11 }}>needs config</span>}
            </button>
          ))}
        </div>
        {provider && (
          <>
            <p className="muted" style={{ fontSize: 13 }}>{provider.description}</p>
            {!provider.available && (
              <div className="card" style={{ borderColor: "var(--warn)", fontSize: 13 }}>
                Missing env: <span className="mono">{provider.missingEnv.join(", ")}</span>. You can
                still save this simulation; runs will fail until these are set.
              </div>
            )}
            {provider.fields.map((f) => (
              <Field key={f.key} label={f.label + (f.required ? " *" : "")} help={f.help}>
                {f.kind === "textarea" ? (
                  <textarea
                    value={targetConfig[f.key] ?? ""}
                    onChange={(e) => setTargetConfig({ ...targetConfig, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    rows={3}
                  />
                ) : (
                  <input
                    value={targetConfig[f.key] ?? ""}
                    onChange={(e) => setTargetConfig({ ...targetConfig, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                  />
                )}
              </Field>
            ))}
          </>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Persona (the caller)</h2>
        <Field label="Persona name">
          <input value={personaName} onChange={(e) => setPersonaName(e.target.value)} />
        </Field>
        <Field label="Persona system prompt">
          <textarea value={personaPrompt} onChange={(e) => setPersonaPrompt(e.target.value)} rows={3} />
        </Field>
      </section>

      <StepEditor steps={steps} setSteps={setSteps} />
      <JudgeEditor
        criteria={criteria}
        setCriteria={setCriteria}
        rules={rules}
        setRules={setRules}
      />
      <MetricsEditor metrics={metrics} setMetrics={setMetrics} />

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button onClick={submit} disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create simulation"}
        </button>
        <a href="/" className="btn secondary">Cancel</a>
      </div>
    </div>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {help && <span className="muted" style={{ fontSize: 12 }}>{help}</span>}
    </label>
  );
}

function StepEditor({
  steps,
  setSteps,
}: {
  steps: ScenarioStep[];
  setSteps: (s: ScenarioStep[]) => void;
}) {
  function update(i: number, step: ScenarioStep) {
    const next = [...steps];
    next[i] = step;
    setSteps(next);
  }
  function remove(i: number) {
    setSteps(steps.filter((_, idx) => idx !== i));
  }
  function add(kind: ScenarioStep["kind"]) {
    const blank: Record<ScenarioStep["kind"], ScenarioStep> = {
      say: { kind: "say", text: "" },
      prompt: { kind: "prompt", directive: "" },
      wait: { kind: "wait" },
      expect: { kind: "expect", assertion: { id: "chk", description: "", matches: "" } },
      hangup: { kind: "hangup" },
      branch: {
        kind: "branch",
        branches: [{ when: "", action: { kind: "say", text: "" } }],
      },
    };
    setSteps([...steps, blank[kind]]);
  }

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Scenario — turn by turn</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Control exactly what the tester does each turn: scripted lines, dynamic persona replies,
        waits, live assertions, and hang-up.
      </p>
      <ol className="step-list">
        {steps.map((s, i) => (
          <li key={i} className="step-item">
            <span className="tag">{s.kind}</span>
            <div className="step-body">
              {s.kind === "say" && (
                <input
                  value={s.text}
                  placeholder="What the tester says…"
                  onChange={(e) => update(i, { ...s, text: e.target.value })}
                />
              )}
              {s.kind === "prompt" && (
                <input
                  value={s.directive}
                  placeholder="Directive, e.g. 'Ask for the first available Tuesday and confirm.'"
                  onChange={(e) => update(i, { ...s, directive: e.target.value })}
                />
              )}
              {s.kind === "wait" && (
                <input
                  value={s.until ?? ""}
                  placeholder="Wait until target reply matches /regex/ (optional)"
                  onChange={(e) => update(i, { ...s, until: e.target.value || undefined })}
                />
              )}
              {s.kind === "expect" && (
                <div className="grid" style={{ gap: 6 }}>
                  <input
                    value={s.assertion.description}
                    placeholder="Assertion description"
                    onChange={(e) =>
                      update(i, { ...s, assertion: { ...s.assertion, description: e.target.value } })
                    }
                  />
                  <input
                    value={s.assertion.matches ?? ""}
                    placeholder="Target reply must match /regex/"
                    onChange={(e) =>
                      update(i, { ...s, assertion: { ...s.assertion, matches: e.target.value } })
                    }
                  />
                </div>
              )}
              {s.kind === "branch" && (
                <BranchStepEditor step={s} onChange={(ns) => update(i, ns)} />
              )}
              {s.kind === "hangup" && <span className="muted">Ends the call.</span>}
            </div>
            <button type="button" className="btn secondary" onClick={() => remove(i)}>✕</button>
          </li>
        ))}
      </ol>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["say", "prompt", "wait", "expect", "branch", "hangup"] as const).map((k) => (
          <button key={k} type="button" className="btn secondary" onClick={() => add(k)}>
            + {k}
          </button>
        ))}
      </div>
    </section>
  );
}

function JudgeEditor({
  criteria,
  setCriteria,
  rules,
  setRules,
}: {
  criteria: string[];
  setCriteria: (c: string[]) => void;
  rules: JudgeRule[];
  setRules: (r: JudgeRule[]) => void;
}) {
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Judge — pass criteria</h2>

      <div className="field-label">LLM-judged criteria</div>
      {criteria.map((c, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          <input
            value={c}
            placeholder="The target booked the appointment and confirmed the date."
            onChange={(e) => {
              const next = [...criteria];
              next[i] = e.target.value;
              setCriteria(next);
            }}
          />
          <button type="button" className="btn secondary" onClick={() => setCriteria(criteria.filter((_, idx) => idx !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="btn secondary" onClick={() => setCriteria([...criteria, ""])}>+ criterion</button>

      <div className="field-label" style={{ marginTop: 16 }}>Deterministic rules</div>
      {rules.map((r, i) => (
        <div key={i} className="rule-row">
          <select
            value={r.kind}
            onChange={(e) => {
              const kind = e.target.value as JudgeRule["kind"];
              const next = [...rules];
              next[i] = defaultRule(kind);
              setRules(next);
            }}
          >
            <option value="transcript-contains">transcript contains</option>
            <option value="transcript-not-contains">transcript must not contain</option>
            <option value="min-turns">min turns</option>
            <option value="max-turns">max turns</option>
            <option value="max-latency">max target latency (ms)</option>
          </select>
          <RuleValue rule={r} onChange={(nr) => { const next = [...rules]; next[i] = nr; setRules(next); }} />
          <button type="button" className="btn secondary" onClick={() => setRules(rules.filter((_, idx) => idx !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="btn secondary" onClick={() => setRules([...rules, { kind: "min-turns", count: 3 }])}>+ rule</button>
    </section>
  );
}

type BranchStep = Extract<ScenarioStep, { kind: "branch" }>;

function BranchStepEditor({ step, onChange }: { step: BranchStep; onChange: (s: BranchStep) => void }) {
  function setBranch(i: number, when: string, action: BranchAction) {
    const branches = [...step.branches];
    branches[i] = { ...branches[i], when, action };
    onChange({ ...step, branches });
  }
  return (
    <div className="grid" style={{ gap: 6 }}>
      <span className="muted" style={{ fontSize: 12 }}>
        If the target&apos;s reply matches a pattern, the tester takes that action.
      </span>
      {step.branches.map((b, i) => (
        <div key={i} className="rule-row" style={{ gridTemplateColumns: "1fr 120px 1fr auto" }}>
          <input
            value={b.when}
            placeholder="/regex/ on target reply"
            onChange={(e) => setBranch(i, e.target.value, b.action)}
          />
          <select
            value={b.action.kind}
            onChange={(e) => setBranch(i, b.when, defaultAction(e.target.value as BranchAction["kind"]))}
          >
            <option value="say">say</option>
            <option value="prompt">prompt</option>
            <option value="goto">goto</option>
            <option value="hangup">hangup</option>
          </select>
          <BranchActionValue action={b.action} onChange={(a) => setBranch(i, b.when, a)} />
          <button
            type="button"
            className="btn secondary"
            onClick={() => onChange({ ...step, branches: step.branches.filter((_, idx) => idx !== i) })}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn secondary"
        onClick={() => onChange({ ...step, branches: [...step.branches, { when: "", action: { kind: "say", text: "" } }] })}
      >
        + condition
      </button>
    </div>
  );
}

function defaultAction(kind: BranchAction["kind"]): BranchAction {
  switch (kind) {
    case "say":
      return { kind: "say", text: "" };
    case "prompt":
      return { kind: "prompt", directive: "" };
    case "goto":
      return { kind: "goto", step: 0 };
    case "hangup":
      return { kind: "hangup" };
  }
}

function BranchActionValue({ action, onChange }: { action: BranchAction; onChange: (a: BranchAction) => void }) {
  if (action.kind === "say")
    return <input value={action.text} placeholder="say…" onChange={(e) => onChange({ ...action, text: e.target.value })} />;
  if (action.kind === "prompt")
    return <input value={action.directive} placeholder="directive…" onChange={(e) => onChange({ ...action, directive: e.target.value })} />;
  if (action.kind === "goto")
    return <input type="number" value={action.step} onChange={(e) => onChange({ ...action, step: Number(e.target.value) })} />;
  return <span className="muted">ends call</span>;
}

function MetricsEditor({ metrics, setMetrics }: { metrics: MetricDefinition[]; setMetrics: (m: MetricDefinition[]) => void }) {
  function update(i: number, m: MetricDefinition) {
    const next = [...metrics];
    next[i] = m;
    setMetrics(next);
  }
  function add() {
    setMetrics([
      ...metrics,
      { id: `m${metrics.length + 1}`, name: "", description: "", outputType: "boolean", passIf: { kind: "is-true" } },
    ]);
  }
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Metrics (typed outputs)</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        User-defined metrics the LLM judge scores per call: boolean, rating (scale), enum
        (categories), or number. A pass condition turns a metric into pass/fail.
      </p>
      {metrics.map((m, i) => (
        <div className="card" key={i} style={{ background: "var(--panel-2)" }}>
          <div className="rule-row" style={{ gridTemplateColumns: "1fr 130px auto" }}>
            <input value={m.name} placeholder="Metric name" onChange={(e) => update(i, { ...m, name: e.target.value })} />
            <select
              value={m.outputType}
              onChange={(e) => update(i, { ...m, outputType: e.target.value as MetricDefinition["outputType"] })}
            >
              <option value="boolean">boolean</option>
              <option value="rating">rating</option>
              <option value="enum">enum</option>
              <option value="number">number</option>
            </select>
            <button type="button" className="btn secondary" onClick={() => setMetrics(metrics.filter((_, idx) => idx !== i))}>✕</button>
          </div>
          <input
            style={{ marginTop: 6 }}
            value={m.description}
            placeholder="How the judge should score this (definition)"
            onChange={(e) => update(i, { ...m, description: e.target.value })}
          />
          {m.outputType === "rating" && (
            <div className="rule-row" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 6 }}>
              <input type="number" value={m.scale?.min ?? 1} onChange={(e) => update(i, { ...m, scale: { min: Number(e.target.value), max: m.scale?.max ?? 5 } })} placeholder="min" />
              <input type="number" value={m.scale?.max ?? 5} onChange={(e) => update(i, { ...m, scale: { min: m.scale?.min ?? 1, max: Number(e.target.value) } })} placeholder="max" />
            </div>
          )}
          {m.outputType === "enum" && (
            <input
              style={{ marginTop: 6 }}
              value={(m.options ?? []).join(", ")}
              placeholder="options, comma-separated (e.g. resolved, escalated, abandoned)"
              onChange={(e) => update(i, { ...m, options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            />
          )}
        </div>
      ))}
      <button type="button" className="btn secondary" onClick={add}>+ metric</button>
    </section>
  );
}

function defaultRule(kind: JudgeRule["kind"]): JudgeRule {
  switch (kind) {
    case "transcript-contains":
      return { kind, needle: "", ignoreCase: true };
    case "transcript-not-contains":
      return { kind, needle: "", ignoreCase: true };
    case "min-turns":
      return { kind, count: 3 };
    case "max-turns":
      return { kind, count: 20 };
    case "max-latency":
      return { kind, ms: 3000, role: "target" };
    case "regex":
      return { kind, pattern: "" };
  }
}

function RuleValue({ rule, onChange }: { rule: JudgeRule; onChange: (r: JudgeRule) => void }) {
  if (rule.kind === "transcript-contains" || rule.kind === "transcript-not-contains") {
    return (
      <input
        value={rule.needle}
        placeholder="phrase"
        onChange={(e) => onChange({ ...rule, needle: e.target.value })}
      />
    );
  }
  if (rule.kind === "min-turns" || rule.kind === "max-turns") {
    return (
      <input
        type="number"
        value={rule.count}
        onChange={(e) => onChange({ ...rule, count: Number(e.target.value) })}
      />
    );
  }
  if (rule.kind === "max-latency") {
    return (
      <input
        type="number"
        value={rule.ms}
        onChange={(e) => onChange({ ...rule, ms: Number(e.target.value) })}
      />
    );
  }
  return null;
}
