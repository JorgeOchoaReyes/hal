import Link from "next/link";
import { notFound } from "next/navigation";
import type { JudgeSpec, JudgeVerdict, RunAgentSnapshot } from "@hal/core";
import { getResult, listJudges, listAccounts } from "@/lib/store";
import { RunAudio, ApplyRunJudges } from "@/components/RunDetailActions";

export const dynamic = "force-dynamic";

function Verdict({ verdict }: { verdict: JudgeVerdict }) {
  return <>
    <div className="card-row"><span className={`pill ${verdict.passed ? "passed" : "failed"}`}>{verdict.passed ? "Passed" : "Failed"}</span><strong>{Math.round(verdict.score * 100)}% score</strong></div>
    <p>{verdict.summary}</p>
    {verdict.checks.map((c, i) => <div key={`${c.id}-${i}`} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
      <span className={`label label-${c.passed ? "pass" : "fail"}`}>{c.passed ? "PASS" : "FAIL"}</span> {c.description}
      {c.detail && <p className="muted" style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>{c.detail}</p>}
    </div>)}
    {(verdict.metricResults ?? []).map((m, i) => <div key={`${m.id}-${i}`} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
      <strong>{m.name}: {String(m.value)}</strong> <span className={`label label-${m.passed === null ? "neutral" : m.passed ? "pass" : "fail"}`}>{m.passed === null ? "Informational" : m.passed ? "PASS" : "FAIL"}</span>
      {m.reasoning && <p className="muted">{m.reasoning}</p>}
    </div>)}
  </>;
}

function JudgeConfiguration({ spec }: { spec: JudgeSpec }) {
  return <details style={{ marginTop: 12 }}><summary>Judge configuration and criteria</summary>
    <p className="muted">Mode: {spec.mode ?? "all"} · Provider: {spec.provider ?? "auto"} · Model: {spec.model ?? "provider default"}</p>
    {spec.criteria?.length ? <ul>{spec.criteria.map((c, i) => <li key={i}>{c}</li>)}</ul> : null}
    {(spec.rules ?? []).map((r, i) => <div key={i}><strong>{r.description ?? r.kind}</strong><pre className="run-json">{JSON.stringify(r, null, 2)}</pre></div>)}
    {(spec.metrics ?? []).map((m, i) => <div key={i}><strong>{m.name}</strong><p>{m.description}</p><pre className="run-json">{JSON.stringify({ outputType: m.outputType, passIf: m.passIf, blocking: m.blocking, scale: m.scale, options: m.options }, null, 2)}</pre></div>)}
    {!spec.criteria?.length && !spec.rules?.length && !spec.metrics?.length && <p className="muted">No rules or criteria were configured.</p>}
  </details>;
}

function Agent({ title, agent }: { title: string; agent: RunAgentSnapshot }) {
  const pathwayId = agent.pathwayId ?? (agent.provider === "bland" && agent.configuration?.structured ? agent.externalAgentId : undefined);
  return <section className="card"><p className="field-label">{title}</p><h3 style={{ margin: "8px 0" }}>{agent.name}</h3>
    <dl className="run-facts">
      {agent.id && <><dt>HAL ID</dt><dd className="mono">{agent.id}</dd></>}
      {agent.provider && <><dt>Provider</dt><dd>{agent.provider}</dd></>}
      {agent.externalAgentId && <><dt>Provider agent ID</dt><dd className="mono">{agent.externalAgentId}</dd></>}
      {agent.provider === "bland" && <><dt>Bland pathway ID</dt><dd>{pathwayId ? <><span className="mono">{pathwayId}</span><br /><small className="muted">{agent.pathwaySource === "dispatch" ? "Sent in this run’s dispatch" : agent.pathwaySource === "inbound-number" ? "Read from the inbound number before dispatch" : agent.pathwaySource === "saved-agent" ? "Saved target configuration; inbound assignment not verified" : "Captured from this run’s structured agent"}</small></> : agent.executionMode === "prompt" ? "None — task prompt call" : "Not captured / not verified for this run"}</dd></>}
      {agent.direction && <><dt>Direction</dt><dd>{agent.direction === "inbound" ? "Inbound · receives call" : "Outbound · places call"}</dd></>}
      {agent.phoneNumber && <><dt>Number</dt><dd>{agent.phoneNumber}</dd></>}
    </dl>
    {agent.persona && <details><summary>Persona</summary><p style={{ whiteSpace: "pre-wrap" }}>{agent.persona.systemPrompt}</p></details>}
    {agent.configuration && <details><summary>Agent configuration</summary><pre className="run-json">{JSON.stringify(agent.configuration, null, 2)}</pre></details>}
  </section>;
}

export default async function RunDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getResult(id);
  if (!run) notFound();
  const context = run.context;
  const canDownload = Boolean(context?.transport !== "bland-chat" && run.externalCallId && (!run.recordingSource || run.recordingSource.provider === "bland"));
  return <div className="run-detail">
    <nav style={{ marginTop: 24 }}><Link href="/results">← All results</Link></nav>
    <header className="card-row" style={{ margin: "20px 0" }}><div><p className="field-label">Run details</p><h1 style={{ margin: "6px 0" }}>{run.runLabel ?? context?.simulationName ?? "Saved run"}</h1><span className="muted mono">{run.id}</span></div><span className={`pill ${run.status}`}>{run.status}</span></header>
    <section className="card">
      <dl className="run-facts"><dt>Started</dt><dd>{new Date(run.startedAt).toLocaleString()}</dd><dt>Duration</dt><dd>{run.endedAt ? `${((run.endedAt - run.startedAt) / 1000).toFixed(1)} seconds` : "Not recorded"}</dd><dt>Transcript</dt><dd>{run.transcript.length} turns</dd><dt>Channel</dt><dd>{context?.transport ?? "Not captured on this older run"}</dd>
        {run.externalCallId && <><dt>{context?.transport === "bland-chat" ? "Bland chat ID" : "Provider call ID"}</dt><dd className="mono">{run.externalCallId}</dd></>}
        {context?.account && <><dt>Provider account</dt><dd>{context.account.label} ({context.account.provider})</dd></>}
      </dl>
      {!run.testCaseId.startsWith("hosted:") && <Link href={`/simulations/${encodeURIComponent(run.testCaseId)}`}>Open simulation →</Link>}
      {run.error && <p role="alert" style={{ color: "var(--fail)", whiteSpace: "pre-wrap" }}>{run.error}</p>}
    </section>
    {run.metrics && <section className="card"><h2 style={{ marginTop: 0 }}>Run metrics</h2><dl className="run-facts">
      <dt>Testing agent turns</dt><dd>{run.metrics.agentTurns}</dd><dt>Target turns</dt><dd>{run.metrics.targetTurns}</dd>
      <dt>Average target words</dt><dd>{run.metrics.avgTargetWords}</dd><dt>Target latency</dt><dd>{run.metrics.targetLatency ? `${run.metrics.targetLatency.avg} ms average · ${run.metrics.targetLatency.p95} ms p95` : "Not measured"}</dd>
    </dl><div>{(run.labels ?? []).map((l, i) => <span key={i} className={`label label-${l.tone}`}>{l.text}</span>)}</div></section>}
    {context?.transport !== "bland-chat" && <RunAudio runId={id} recording={run.recording} canDownload={canDownload} needsAccount={!context?.account && run.recording?.status !== "available"} accounts={listAccounts().filter((a) => a.provider === "bland").map((a) => ({ id: a.id, label: a.label }))} />}
    <section><h2>Agents used for this run</h2>{context ? <div className="run-agents"><Agent title="Testing agent" agent={context.testingAgent} /><Agent title="Agent under test" agent={context.targetAgent} /></div> : <p className="card muted">Agent snapshots were not captured for this older run. Current agent settings may differ from those used at the time.</p>}</section>
    <section className="card"><h2 style={{ marginTop: 0 }}>Original judge results</h2>{run.verdict ? <Verdict verdict={run.verdict} /> : <p className="muted">No original judge verdict was saved.</p>}
      {context ? <><JudgeConfiguration spec={context.judge} />{context.judges.length > 0 && <><h3>Saved judges included</h3><p className="muted">These configurations contributed to the combined verdict above.</p>{context.judges.map((j, i) => <div key={`${j.id}-${i}`}><h4>{j.name}</h4>{j.description && <p>{j.description}</p>}<JudgeConfiguration spec={j.spec} /></div>)}</>}</> : <p className="muted">The original judge configuration was not captured on this older run.</p>}
      {run.liveChecks.length > 0 && <><h3>Live checks</h3>{run.liveChecks.map((c, i) => <p key={i}>{c.passed ? "PASS" : "FAIL"} · {c.description}{c.detail ? ` — ${c.detail}` : ""}</p>)}</>}
    </section>
    <ApplyRunJudges runId={id} judges={listJudges()} hasTranscript={run.transcript.length > 0} />
    {(run.evaluations ?? []).length > 0 && <section><h2>Additional evaluations</h2>{[...(run.evaluations ?? [])].reverse().map((e) => <article className="card" key={e.id} style={{ marginBottom: 12 }}><h3 style={{ marginTop: 0 }}>{e.judge.name}</h3><p className="muted">{new Date(e.createdAt).toLocaleString()} · {e.provider || "Provider unavailable"} / {e.model || "default"}</p>{e.error && <p style={{ color: "var(--fail)" }}>{e.error}</p>}{e.verdict && <Verdict verdict={e.verdict} />}<JudgeConfiguration spec={e.judge.spec} /></article>)}</section>}
    <section className="card"><h2 style={{ marginTop: 0 }}>Transcript</h2>{!run.transcript.length ? <p className="muted">No transcript was captured.</p> : <div className="transcript">{run.transcript.map((turn, i) => <div className={`turn ${turn.role}`} key={i}><div className="who">{turn.role === "agent" ? "Testing agent" : turn.role === "target" ? "Agent under test" : "System"}</div><div style={{ whiteSpace: "pre-wrap" }}>{turn.text}</div></div>)}</div>}</section>
  </div>;
}
