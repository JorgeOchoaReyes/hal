"use client";

import { useEffect, useState } from "react";
import type {
  ScenarioStep,
  BranchAction,
  StructuredTest,
  StructuredCondition,
  SavedJudge,
  Transcript,
} from "@hal/core";
// Import the pure parser from a barrel-free subpath so the client bundle doesn't
// pull in node:crypto (used elsewhere in the @hal/core index).
import { parseTranscript, transcriptToSayScript } from "@hal/core/transcript";

/** Turn pasted transcript text into the tester's `say` script (caller's turns). */
function transcriptTextToSteps(text: string): ScenarioStep[] {
  return transcriptToSayScript(parseTranscript(text));
}

/** The CALLER's turns from a structured transcript become `say` steps. */
function transcriptToSteps(t: Transcript): ScenarioStep[] {
  return transcriptToSayScript(t);
}

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

interface SavedTarget {
  id: string;
  name: string;
  target: { transport: string };
  description?: string;
}

export default function SimulationForm() {
  // "Mock" is the only inline target template offered at creation — a real
  // transport is decided later, either by picking a saved "My agents" entry
  // above, or by dispatching to a hosted provider when the simulation runs.
  const [mockTemplate, setMockTemplate] = useState<ProviderView | null>(null);
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [targetConfig, setTargetConfig] = useState<Record<string, string>>({});
  const [savedTargets, setSavedTargets] = useState<SavedTarget[]>([]);
  // "" = configure inline; otherwise a saved "My agents" id.
  const [targetAgentId, setTargetAgentId] = useState("");
  const [testingAgents, setTestingAgents] = useState<Array<{ id: string; name: string; provider: string }>>([]);
  // "" = provision ad-hoc at dispatch; otherwise a provisioned testing agent id.
  const [testingAgentId, setTestingAgentId] = useState("");
  const [personaName, setPersonaName] = useState("Everyday customer");
  const [personaPrompt, setPersonaPrompt] = useState(
    "You are a polite but busy customer calling a business. Answer questions directly.",
  );
  const [steps, setSteps] = useState<ScenarioStep[]>([
    { kind: "say", text: "Hi, I'd like some help please." },
  ]);
  const [judges, setJudges] = useState<SavedJudge[]>([]);
  const [judgeIds, setJudgeIds] = useState<Set<string>>(new Set());
  const [importText, setImportText] = useState("");
  const [importNote, setImportNote] = useState<string | null>(null);
  const [mode, setMode] = useState<"steps" | "structured">("steps");
  const [structured, setStructured] = useState<StructuredTest>({
    role: "You are a customer calling to book an appointment.",
    conditions: [
      { id: 0, condition: "FIRST_MESSAGE", action: "Hi, I'd like to book an appointment.", type: "standard", fixed_message: true },
      { id: 1, condition: "The agent asks which day you want", action: "Ask for the first available Tuesday", type: "standard", fixed_message: false },
    ],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((d) => {
        const mock = d.providers.find((p: ProviderView) => p.id === "mock");
        if (mock) {
          setMockTemplate(mock);
          const cfg: Record<string, string> = {};
          for (const f of mock.fields) cfg[f.key] = f.default ?? "";
          setTargetConfig(cfg);
        }
      })
      .catch(() => setError("Failed to load providers"));
    fetch("/api/targets")
      .then((r) => r.json())
      .then((d) => setSavedTargets(d.targets ?? []))
      .catch(() => undefined);
    fetch("/api/testing-agents")
      .then((r) => r.json())
      .then((d) => setTestingAgents(d.agents ?? []))
      .catch(() => undefined);
    fetch("/api/judges")
      .then((r) => r.json())
      .then((d) => setJudges(d.judges ?? []))
      .catch(() => undefined);

    // Prefill from a transcribed production call: /simulations/new?fromCall=<id>
    const fromCall = new URLSearchParams(window.location.search).get("fromCall");
    if (fromCall) {
      fetch("/api/prod-calls")
        .then((r) => r.json())
        .then((d: { prodCalls: Array<{ id: string; name: string; transcript: Transcript }> }) => {
          const call = d.prodCalls?.find((c) => c.id === fromCall);
          if (!call) return;
          const s = transcriptToSteps(call.transcript);
          if (s.length > 0) {
            setSteps(s);
            setMode("steps");
            setName(`${call.name} — replay`);
            setPersonaName("Imported caller");
            setImportNote(`Imported ${s.length} caller turn${s.length === 1 ? "" : "s"} from “${call.name}”.`);
          }
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function importTranscript() {
    const s = transcriptTextToSteps(importText);
    if (s.length === 0) {
      setImportNote("No caller turns found. Prefix lines with “agent:” / “target:”, or alternate lines.");
      return;
    }
    setSteps(s);
    setMode("steps");
    if (!name.trim()) setName("Imported from transcript");
    setImportNote(`Imported ${s.length} caller turn${s.length === 1 ? "" : "s"} as the tester's script. Edit below before saving.`);
  }

  async function onTranscriptFile(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setImportText(text);
  }

  function toggleJudge(id: string) {
    setJudgeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
          providerId: "mock",
          targetConfig,
          targetAgentId: targetAgentId || undefined,
          testingAgentId: testingAgentId || undefined,
          persona: { name: personaName, systemPrompt: personaPrompt },
          steps: mode === "steps" ? steps : undefined,
          structured: mode === "structured" ? structured : undefined,
          judge: { mode: "all" },
          judgeIds: [...judgeIds],
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create");
      window.location.href = `/simulations/${data.testCase.id}`;
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

      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          Import from a transcript — turn a real call into a simulation
        </summary>
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          Paste or upload a call transcript. The <strong>caller&apos;s</strong> turns become the
          tester&apos;s script (as <span className="mono">say</span> steps); the target/AI turns are
          left for the agent under test to produce. Prefix lines with{" "}
          <span className="mono">agent:</span> / <span className="mono">target:</span>, or let them
          alternate (caller first).
        </p>
        <Field label="Upload a transcript file (.txt)">
          <input type="file" accept=".txt,.json,text/plain" onChange={(e) => onTranscriptFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="…or paste it here">
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={6}
            placeholder={"agent: Hi, I'd like to book an appointment.\ntarget: Sure! What day works for you?\nagent: The first available Tuesday."}
          />
        </Field>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" onClick={importTranscript} disabled={!importText.trim()}>
            Import into script
          </button>
          {importNote && <span className="muted" style={{ fontSize: 12 }}>{importNote}</span>}
        </div>
      </details>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Target — agent under test</h2>
        <Field label="Use a saved agent (from My agents)" help="Pick a registered target, or configure one inline below.">
          <select value={targetAgentId} onChange={(e) => setTargetAgentId(e.target.value)}>
            <option value="">Configure inline…</option>
            {savedTargets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.target.transport})
              </option>
            ))}
          </select>
        </Field>
        {!targetAgentId && savedTargets.length === 0 && (
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Tip: add reusable targets on the <a href="/targets">My agents</a> page.
          </p>
        )}
        <Field
          label="Testing agent (the caller, optional)"
          help="Run this simulation with a specific provisioned testing agent. Leave as Auto to provision one on dispatch. Its prompt is reconfigured for this simulation each run."
        >
          <select value={testingAgentId} onChange={(e) => setTestingAgentId(e.target.value)}>
            <option value="">Auto — provision at dispatch</option>
            {testingAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.provider})
              </option>
            ))}
          </select>
        </Field>
      </section>

      {!targetAgentId && mockTemplate && (
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Simulated target (for authoring)</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          No saved agent picked above, so this simulation authors against a simulated (mock)
          target — an LLM standing in for the real voice AI, no call or credentials needed. How to
          actually run this for real is decided later, when you run it: dispatch it to a hosted
          provider, or point it at a real agent by picking one under &quot;My agents&quot; above.
        </p>
        {mockTemplate.fields.map((f) => (
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
      </section>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Persona (the caller)</h2>
        <Field label="Persona name">
          <input value={personaName} onChange={(e) => setPersonaName(e.target.value)} />
        </Field>
        <Field label="Persona system prompt">
          <textarea value={personaPrompt} onChange={(e) => setPersonaPrompt(e.target.value)} rows={3} />
        </Field>
      </section>

      <section className="card">
        <div className="card-row">
          <h2 style={{ margin: 0 }}>Conversation model</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className={`btn ${mode === "steps" ? "" : "secondary"}`}
              onClick={() => setMode("steps")}
            >
              Linear steps
            </button>
            <button
              type="button"
              className={`btn ${mode === "structured" ? "" : "secondary"}`}
              onClick={() => setMode("structured")}
            >
              Structured test
            </button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          {mode === "steps"
            ? "A linear script the tester follows turn by turn."
            : "A role + conditions decision tree — the tester adapts to what the agent says."}
        </p>
      </section>

      {mode === "steps" ? (
        <StepEditor steps={steps} setSteps={setSteps} />
      ) : (
        <StructuredEditor test={structured} setTest={setStructured} />
      )}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Judges (how this simulation is scored)</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Attach one or more reusable judges — LLM criteria, deterministic rules, or typed metrics —
          to score this simulation. Create and edit them on the <a href="/judges">Judges</a> page,
          where they can also be attached to other simulations or to agents under test.
        </p>
        {judges.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>No saved judges yet.</p>
        ) : (
          <div className="grid" style={{ gap: 6 }}>
            {judges.map((j) => (
              <label
                key={j.id}
                className="card-row"
                style={{ cursor: "pointer", background: "var(--panel-2)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
              >
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={judgeIds.has(j.id)} onChange={() => toggleJudge(j.id)} />
                  <span>
                    <strong>{j.name}</strong> <span className="tag">{j.kind}</span>
                    {j.description && <div className="muted" style={{ fontSize: 12 }}>{j.description}</div>}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

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

function StructuredEditor({ test, setTest }: { test: StructuredTest; setTest: (t: StructuredTest) => void }) {
  function updateCondition(i: number, c: StructuredCondition) {
    const conditions = [...test.conditions];
    conditions[i] = c;
    setTest({ ...test, conditions });
  }
  function addCondition() {
    const nextId = Math.max(0, ...test.conditions.map((c) => c.id)) + 1;
    setTest({
      ...test,
      conditions: [
        ...test.conditions,
        { id: nextId, condition: "The agent asks something", action: "", type: "standard", fixed_message: false },
      ],
    });
  }
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Structured test</h2>
      <label className="field">
        <span className="field-label">Role (who the tester pretends to be)</span>
        <textarea value={test.role} onChange={(e) => setTest({ ...test, role: e.target.value })} rows={2} />
      </label>
      <div className="field-label">Conditions</div>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        id 0 is <span className="mono">FIRST_MESSAGE</span> (the opening line). Standard conditions
        fire when their trigger matches the agent; action-followups fire on the next turn after the
        referenced id. fixed = say verbatim; otherwise the action is an instruction.
      </p>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Fixed actions support control tags:{" "}
        <span className="mono">
          &lt;endcall/&gt; &lt;silence time=&quot;2s&quot;/&gt; &lt;hold/&gt; &lt;dtmf digits=&quot;123&quot;/&gt;
          &lt;spell&gt;ABC&lt;/spell&gt; &lt;ivr text=&quot;…&quot;/&gt; &lt;voicemail/&gt; &lt;speed/&gt; &lt;volume/&gt;
          &lt;voice/&gt; &lt;background_noise/&gt; &lt;noise/&gt; &lt;send_sms/&gt; &lt;interruption/&gt;
        </span>
        . (Functions, attached audio, RTVI and network-sim tags are not supported.)
      </p>
      {test.conditions.map((c, i) => (
        <div className="card" key={c.id} style={{ background: "var(--panel-2)" }}>
          <div className="rule-row" style={{ gridTemplateColumns: "48px 1fr 120px auto" }}>
            <span className="mono muted">#{c.id}</span>
            {c.id === 0 ? (
              <span className="mono">FIRST_MESSAGE</span>
            ) : c.type === "action_followup" ? (
              <input
                type="number"
                value={typeof c.condition === "number" ? c.condition : 0}
                onChange={(e) => updateCondition(i, { ...c, condition: Number(e.target.value) })}
                placeholder="after id"
              />
            ) : (
              <input
                value={String(c.condition)}
                placeholder="When… (e.g. The agent asks for your name)"
                onChange={(e) => updateCondition(i, { ...c, condition: e.target.value })}
              />
            )}
            <select
              value={c.type}
              disabled={c.id === 0}
              onChange={(e) => {
                const type = e.target.value as StructuredCondition["type"];
                updateCondition(i, {
                  ...c,
                  type,
                  condition: type === "action_followup" ? Math.max(0, c.id - 1) : "The agent asks something",
                });
              }}
            >
              <option value="standard">standard</option>
              <option value="action_followup">action_followup</option>
            </select>
            {c.id === 0 ? (
              <span />
            ) : (
              <button
                type="button"
                className="btn secondary"
                onClick={() => setTest({ ...test, conditions: test.conditions.filter((_, idx) => idx !== i) })}
              >
                ✕
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
            <input
              value={c.action}
              placeholder={c.fixed_message ? "Exact words to say" : "Instruction to interpret"}
              onChange={(e) => updateCondition(i, { ...c, action: e.target.value })}
            />
            <label className="muted" style={{ fontSize: 12, display: "flex", gap: 4, whiteSpace: "nowrap" }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={c.fixed_message}
                disabled={c.id === 0}
                onChange={(e) => updateCondition(i, { ...c, fixed_message: e.target.checked })}
              />
              fixed
            </label>
          </div>
        </div>
      ))}
      <button type="button" className="btn secondary" onClick={addCondition}>+ condition</button>
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

