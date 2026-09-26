"use client";

import { useEffect, useState } from "react";
import { StepEditor, StructuredEditor } from "./ScenarioFields";
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

interface ProviderAccount {
  id: string;
  provider: string;
  label: string;
}

export default function SimulationForm({
  fromCallId,
  onCreated,
  onCancel,
}: {
  /** Prefill from a transcribed production call, e.g. when opened from its "→ Simulation" action. */
  fromCallId?: string;
  /** Called with the new simulation's id once it's created. */
  onCreated: (id: string) => void;
  /** Called when the user cancels out of the form. */
  onCancel: () => void;
}) {
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
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [callAccountId, setCallAccountId] = useState("");
  const [callId, setCallId] = useState("");
  const [callImportBusy, setCallImportBusy] = useState(false);
  const [callImportError, setCallImportError] = useState<string | null>(null);
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
    fetch("/api/provider-accounts")
      .then((r) => r.json())
      .then((d: { accounts?: ProviderAccount[] }) => setAccounts(d.accounts ?? []))
      .catch(() => undefined);

    if (fromCallId) {
      fetch("/api/prod-calls")
        .then((r) => r.json())
        .then((d: { prodCalls: Array<{ id: string; name: string; transcript: Transcript }> }) => {
          const call = d.prodCalls?.find((c) => c.id === fromCallId);
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

  async function importFromProviderCall() {
    setCallImportBusy(true);
    setCallImportError(null);
    try {
      const res = await fetch(
        `/api/hosted-integrations/call-transcript?accountId=${encodeURIComponent(callAccountId)}&callId=${encodeURIComponent(callId)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch transcript");
      const s = transcriptToSteps(data.transcript);
      if (s.length === 0) {
        setCallImportError("That call's transcript has no caller turns to import.");
        return;
      }
      setSteps(s);
      setMode("steps");
      if (!name.trim()) setName(`Call ${callId} — replay`);
      setImportNote(`Imported ${s.length} caller turn${s.length === 1 ? "" : "s"} from call “${callId}”. Edit below before saving.`);
    } catch (e) {
      setCallImportError((e as Error).message);
    } finally {
      setCallImportBusy(false);
    }
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
      onCreated(data.testCase.id);
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

        <p className="muted" style={{ fontSize: 13, marginTop: 16, marginBottom: 4 }}>
          …or pull a call straight from a connected provider by its call id.
        </p>
        {accounts.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            No provider accounts connected — connect one on <a href="/agents">Hosted agents</a>.
          </p>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select value={callAccountId} onChange={(e) => setCallAccountId(e.target.value)} style={{ width: "auto" }}>
              <option value="">— select a connected account —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} ({a.provider})
                </option>
              ))}
            </select>
            <input
              value={callId}
              onChange={(e) => setCallId(e.target.value)}
              placeholder="Call id"
              style={{ width: "auto" }}
            />
            <button
              type="button"
              onClick={importFromProviderCall}
              disabled={callImportBusy || !callAccountId || !callId.trim()}
            >
              {callImportBusy ? "Fetching…" : "Fetch transcript"}
            </button>
          </div>
        )}
        {callImportError && (
          <div className="muted" style={{ color: "var(--fail)", fontSize: 12, marginTop: 6 }}>
            {callImportError}
          </div>
        )}
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
        <button type="button" className="btn secondary" onClick={onCancel}>
          Cancel
        </button>
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

