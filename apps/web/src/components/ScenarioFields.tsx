"use client";
import type { ScenarioStep, BranchAction, StructuredTest, StructuredCondition } from "@hal/core";

export function StepEditor({
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

export function StructuredEditor({ test, setTest }: { test: StructuredTest; setTest: (t: StructuredTest) => void }) {
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
