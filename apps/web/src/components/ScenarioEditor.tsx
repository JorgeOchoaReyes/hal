"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Scenario } from "@hal/core";
import { StepEditor, StructuredEditor } from "./ScenarioFields";

export default function ScenarioEditor({ testCaseId, initial }: { testCaseId: string; initial: Scenario }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setBusy(true); setMessage("");
    try {
      const res = await fetch(`/api/testcases/${encodeURIComponent(testCaseId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: draft, expectedScenario: baseline }) });
      const data = await res.json();
      if (res.status === 409) router.refresh();
      if (!res.ok) throw new Error(data.error ?? "Could not save scenario");
      setEditing(false); setMessage("Scenario saved. Future runs use these changes."); router.refresh();
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section id="scenario" className="scenario-editor">
    <div className="section-heading"><div><h2>Scenario</h2><p className="muted">The instructions and script used by the testing agent.</p></div>
      {!editing && <button className="secondary" onClick={() => { setDraft(structuredClone(initial)); setBaseline(initial); setMessage(""); setEditing(true); }}>Edit scenario</button>}
    </div>
    {editing ? <fieldset disabled={busy} className="scenario-fields">
      <div className="card settings-grid">
        <label className="field"><span className="field-label">Persona name</span><input value={draft.persona.name} onChange={(e) => setDraft({ ...draft, persona: { ...draft.persona, name: e.target.value } })} /></label>
        <label className="field full-width"><span className="field-label">Persona instructions</span><textarea rows={3} value={draft.persona.systemPrompt} onChange={(e) => setDraft({ ...draft, persona: { ...draft.persona, systemPrompt: e.target.value } })} /></label>
        <label className="field full-width"><span className="field-label">Scenario description</span><textarea rows={2} value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
      </div>
      {draft.structured ? <StructuredEditor test={draft.structured} setTest={(structured) => setDraft({ ...draft, structured })} /> : <StepEditor steps={draft.steps} setSteps={(steps) => setDraft({ ...draft, steps })} />}
      <div className="action-bar"><span className="muted">Save before starting a new run.</span><div className="button-row"><button className="secondary" onClick={() => { setEditing(false); setMessage(""); }}>Cancel</button><button onClick={save}>{busy ? "Saving…" : "Save scenario"}</button></div></div>
    </fieldset> : <div className="card">
      <h3>{initial.persona.name}</h3><p className="muted">{initial.persona.systemPrompt}</p>
      {initial.structured ? <><p><strong>Role:</strong> {initial.structured.role}</p><ol className="scenario-preview">{initial.structured.conditions.map((c) => <li key={c.id}><span className="tag">{c.id === 0 ? "Opening" : c.type === "action_followup" ? `After #${c.condition}` : String(c.condition)}</span> {c.action}</li>)}</ol></> : <ol className="scenario-preview">{initial.steps.map((s, i) => <li key={i}><span className="tag">{s.kind}</span> {s.kind === "say" ? `“${s.text}”` : s.kind === "prompt" ? s.directive : s.kind === "wait" ? s.until ? `Until /${s.until}/` : "Wait for reply" : s.kind === "hangup" ? "End the conversation" : s.kind === "expect" ? s.assertion.description : `${s.branches.length} branches`}</li>)}</ol>}
    </div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
