import Link from "next/link";
import { notFound } from "next/navigation";
import { getTestCase, listResults } from "@/lib/store";
import RunPanel from "@/components/RunPanel";
import DispatchHosted from "@/components/DispatchHosted";
import AttachJudges from "@/components/AttachJudges";
import type { ScenarioStep, JudgeRule, Target } from "@hal/core";

export const dynamic = "force-dynamic";

export default async function TestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tc = getTestCase(id);
  if (!tc) notFound();
  const results = listResults(id).slice(0, 10);

  return (
    <>
      <p style={{ marginTop: 20 }}>
        <Link href="/">← All simulations</Link>
      </p>
      <div className="card-row">
        <h1 style={{ margin: 0 }}>{tc.name}</h1>
        <span className={`pill ${tc.target.transport}`}>{tc.target.transport}</span>
      </div>
      <p className="sub">{tc.scenario.description}</p>

      <h2>Run this simulation</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: -8, marginBottom: 12 }}>
        How this runs is decided here, not at creation. Clicking run opens a popup where you can
        pick which agent to run against, its direction, which judges score it, an optional label
        to find the run(s) later on the Results page, and how many times to run it — or dispatch
        it to a hosted provider for a real call below, where HAL pulls the result once it ends.
      </p>
      <RunPanel testCaseId={tc.id} />
      <div style={{ marginTop: 12 }}>
        <div className="field-label" style={{ marginBottom: 6 }}>
          Or dispatch to a hosted provider (real call)
        </div>
        <DispatchHosted testCaseId={tc.id} />
      </div>

      <h2>Judges</h2>
      <AttachJudges patchUrl={`/api/testcases/${tc.id}`} initial={tc.judgeIds ?? []} />

      {results.length > 0 && (
        <>
          <h2>Recent runs</h2>
          <div className="card">
            {results.map((r) => (
              <div key={r.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <div className="card-row">
                  <div className="muted" style={{ fontSize: 13 }}>
                    {new Date(r.startedAt).toLocaleString()}
                    {r.runLabel && <span className="mono" style={{ marginLeft: 8 }}>“{r.runLabel}”</span>}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {(r.labels ?? []).map((l, i) => (
                      <span key={i} className={`label label-${l.tone}`}>{l.text}</span>
                    ))}
                    {!r.labels && <span className={`pill ${r.status}`}>{r.status}</span>}
                  </div>
                </div>
                {r.error && (
                  <div
                    className="mono muted"
                    style={{ fontSize: 12, marginTop: 4, color: "var(--fail)", whiteSpace: "pre-wrap" }}
                  >
                    {r.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <h2>Target under test</h2>
      <div className="card">
        <div>
          <strong>{tc.target.name}</strong>{" "}
          <span className={`pill ${tc.target.transport}`}>{tc.target.transport}</span>
        </div>
        <div className="mono muted" style={{ marginTop: 8 }}>
          {targetDetail(tc.target)}
        </div>
      </div>

      <h2>Persona</h2>
      <div className="card">
        <strong>{tc.scenario.persona.name}</strong>
        <p className="muted" style={{ marginBottom: 0 }}>
          {tc.scenario.persona.systemPrompt}
        </p>
      </div>

      {tc.scenario.structured ? (
        <>
          <h2>Structured test</h2>
          <div className="card">
            <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
              <strong>Role:</strong> {tc.scenario.structured.role}
            </div>
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {tc.scenario.structured.conditions.map((c) => (
                <li key={c.id} style={{ padding: "4px 0" }}>
                  <span className="tag">{c.type}</span>{" "}
                  <span className="mono">
                    {c.id === 0 ? "FIRST_MESSAGE" : c.type === "action_followup" ? `after #${c.condition}` : `“${c.condition}”`}
                  </span>{" "}
                  → {c.fixed_message ? <span className="mono">“{c.action}”</span> : <span className="muted">{c.action}</span>}
                </li>
              ))}
            </ol>
          </div>
        </>
      ) : (
        <>
          <h2>Scenario script ({tc.scenario.steps.length} steps)</h2>
          <div className="card">
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {tc.scenario.steps.map((s, i) => (
                <li key={i} style={{ padding: "4px 0" }}>
                  {renderStep(s)}
                </li>
              ))}
            </ol>
          </div>
        </>
      )}

      <h2>Pass criteria</h2>
      <div className="card">
        {(tc.judge.rules?.length ?? 0) > 0 && (
          <>
            <div className="muted" style={{ fontSize: 12, textTransform: "uppercase" }}>
              Deterministic rules
            </div>
            <ul className="checks">
              {tc.judge.rules!.map((r, i) => (
                <li key={i} className="pass">
                  <span className="mark">▸</span>
                  <span className="mono">{renderRule(r)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {(tc.judge.criteria?.length ?? 0) > 0 && (
          <>
            <div
              className="muted"
              style={{ fontSize: 12, textTransform: "uppercase", marginTop: 10 }}
            >
              LLM-judged criteria
            </div>
            <ul className="checks">
              {tc.judge.criteria!.map((c, i) => (
                <li key={i} className="pass">
                  <span className="mark">▸</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

function renderStep(s: ScenarioStep): React.ReactNode {
  switch (s.kind) {
    case "say":
      return (
        <>
          <span className="tag">say</span> <span className="mono">“{s.text}”</span>
        </>
      );
    case "prompt":
      return (
        <>
          <span className="tag">prompt</span> <span className="muted">{s.directive}</span>
        </>
      );
    case "wait":
      return (
        <>
          <span className="tag">wait</span>{" "}
          <span className="muted">
            {s.until ? `until /${s.until}/` : "for reply"}
            {s.timeoutMs ? ` (${s.timeoutMs}ms)` : ""}
          </span>
        </>
      );
    case "expect":
      return (
        <>
          <span className="tag">expect</span> <span className="muted">{s.assertion.description}</span>
        </>
      );
    case "branch":
      return (
        <>
          <span className="tag">branch</span>{" "}
          <span className="muted">
            {s.branches.length} condition{s.branches.length === 1 ? "" : "s"}
            {s.branches.slice(0, 3).map((b, i) => (
              <span key={i} className="mono" style={{ display: "block", marginLeft: 8 }}>
                if /{b.when}/ → {b.action.kind}
                {b.action.kind === "say" ? `: “${b.action.text}”` : ""}
                {b.action.kind === "prompt" ? `: ${b.action.directive}` : ""}
                {b.action.kind === "goto" ? ` step ${b.action.step}` : ""}
              </span>
            ))}
          </span>
        </>
      );
    case "hangup":
      return <span className="tag">hangup</span>;
  }
}

function renderRule(r: JudgeRule): string {
  switch (r.kind) {
    case "transcript-contains":
      return `transcript contains "${r.needle}"`;
    case "transcript-not-contains":
      return `transcript must NOT contain "${r.needle}"`;
    case "regex":
      return `matches /${r.pattern}/${r.role ? ` on ${r.role}` : ""}`;
    case "max-latency":
      return `${r.role ?? "any"} latency ≤ ${r.ms}ms`;
    case "min-turns":
      return `at least ${r.count} turns`;
    case "max-turns":
      return `at most ${r.count} turns`;
  }
}

function targetDetail(target: Target): string {
  switch (target.transport) {
    case "mock":
      return `simulated agent · greeting: ${target.mock.greeting ?? "(none)"}`;
    case "telephony":
      return `dial ${target.phoneNumber} via Twilio`;
    case "webrtc":
      return `join ${target.signalingUrl}${target.room ? ` room ${target.room}` : ""}`;
    case "sip":
      return `dial ${target.uri}`;
  }
}
