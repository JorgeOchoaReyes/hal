import Link from "next/link";
import { notFound } from "next/navigation";
import type { JudgeSpec, JudgeVerdict, RunAgentSnapshot } from "@hal/core";
import { getResult, listJudges, listAccounts } from "@/lib/store";
import { RunAudio, ApplyRunJudges, CheckHostedCall, HostedRunWatcher, AttachProviderCall, SyncSavedRun } from "@/components/RunDetailActions";
import MetadataJsonViewer from "@/components/MetadataJsonViewer";
import RunActivityTimeline from "@/components/RunActivityTimeline";
import HalMessageCheck from "@/components/HalMessageCheck";
import { halMessageCheck } from "@/lib/halMessageCheck";
import { judgeResultGroups, type JudgeSignals } from "@/lib/judgeResultGroups";

export const dynamic = "force-dynamic";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function callFacts(details: Record<string, unknown>): string[] {
  const metadata = record(details.metadata);
  const durationMs = details.duration_ms;
  const durationSecs = details.duration ?? details.call_duration ?? metadata.call_duration_secs;
  const cost = details.cost ?? details.cost_fiat ?? metadata.cost_fiat;
  return [
    typeof details.status === "string" ? `Status: ${details.status}` : typeof details.call_status === "string" ? `Status: ${details.call_status}` : undefined,
    typeof durationMs === "number" ? `Duration: ${(durationMs / 1000).toFixed(1)}s` : typeof durationSecs === "number" ? `Duration: ${durationSecs.toFixed(1)}s` : undefined,
    typeof cost === "number" ? `Cost: ${cost}` : undefined,
    typeof details.pathway_id === "string" ? `Pathway: ${details.pathway_id}` : typeof details.agent_id === "string" ? `Agent: ${details.agent_id}` : undefined,
  ].filter((item): item is string => Boolean(item));
}

function VerdictAssessment({ verdict }: { verdict: JudgeVerdict }) {
  return <>
    <div className="card-row"><span className={`pill ${verdict.passed ? "passed" : "failed"}`}>{verdict.passed ? "Passed" : "Failed"}</span><strong>{Math.round(verdict.score * 100)}% score</strong></div>
    <p>{verdict.summary}</p>
  </>;
}

function VerdictSignals({ signals }: { signals: JudgeSignals }) {
  return <>
    {signals.checks.map((c, i) => <div key={`${c.id}-${i}`} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
      <span className={`label label-${c.passed ? "pass" : "fail"}`}>{c.passed ? "PASS" : "FAIL"}</span> {c.description}
      {c.detail && <p className="muted" style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>{c.detail}</p>}
    </div>)}
    {signals.metrics.map((m, i) => <div key={`${m.id}-${i}`} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
      <strong>{m.name}: {String(m.value)}</strong> <span className={`label label-${m.passed === null ? "neutral" : m.passed ? "pass" : "fail"}`}>{m.passed === null ? "Informational" : m.passed ? "PASS" : "FAIL"}</span>
      {m.reasoning && <p className="muted">{m.reasoning}</p>}
    </div>)}
  </>;
}

function Verdict({ verdict }: { verdict: JudgeVerdict }) {
  return <><VerdictAssessment verdict={verdict} /><VerdictSignals signals={{ checks: verdict.checks, metrics: verdict.metricResults ?? [] }} /></>;
}

const hasSignals = (signals: JudgeSignals) => signals.checks.length > 0 || signals.metrics.length > 0;

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
  const judgeSignals = run.verdict ? judgeResultGroups(run.verdict, context) : undefined;
  const retryJudgeError = run.status === "failed" && Boolean(run.verdict?.summary.startsWith("Judge LLM error:"));
  const canDownload = Boolean(context?.transport !== "bland-chat" && run.externalCallId);
  const primarySide = context?.targetAgent.direction === "outbound" ? "targetAgent" : "testingAgent";
  const primaryCall = run.providerCalls?.[primarySide];
  const recordingAccounts = listAccounts().filter((account) => !primaryCall || account.provider === primaryCall.provider)
    .map((account) => ({ id: account.id, label: `${account.label} (${account.provider})` }));
  const transcriptMetadata = run.transcript.map((turn) => ({ role: turn.role, text: turn.text,
    startedAt: turn.startedAt, audioStartMs: turn.audioStartMs, metadataSource: turn.metadataSource ?? (turn.meta ? primarySide : undefined), meta: turn.meta }));
  const metadataViews = (["testingAgent", "targetAgent"] as const).map((side) => ({
    id: side, label: side === "testingAgent" ? "HAL testing agent" : "Main agent",
    hasCallRecord: Boolean(run.providerCalls?.[side]),
    json: JSON.stringify({ agent: side, call: run.providerCalls?.[side] ?? null,
      ...(side === "testingAgent" ? { halMessageCheck: halMessageCheck(run) ?? null } : {}),
      messagesCapturedByThisCall: transcriptMetadata.filter((turn) => turn.metadataSource === side),
      activity: (run.trace ?? []).filter((event) => event.side === side) }, null, 2),
  }));
  const fullMetadataView = { id: "both" as const, label: "Both agents and full run", hasCallRecord: true,
    json: JSON.stringify({ runId: run.id, externalCallId: run.externalCallId, providerCalls: run.providerCalls ?? {}, halMessageCheck: halMessageCheck(run) ?? null,
      transcript: transcriptMetadata, activity: run.trace ?? [] }, null, 2) };
  const providerAccounts = listAccounts().map(({ id, label, provider }) => ({ id, label, provider }));
  return <div className="run-detail">
    <nav style={{ marginTop: 24 }}><Link href="/results">← All results</Link></nav>
    <header className="card-row" style={{ margin: "20px 0" }}><div><p className="field-label">Run details</p><h1 style={{ margin: "6px 0" }}>{run.runLabel ?? context?.simulationName ?? "Saved run"}</h1><span className="muted mono">{run.id}</span></div><span className={`pill ${run.status}`}>{run.status}</span></header>
    <section className="card">
      <dl className="run-facts"><dt>Started</dt><dd>{new Date(run.startedAt).toLocaleString()}</dd><dt>Duration</dt><dd>{run.endedAt ? `${((run.endedAt - run.startedAt) / 1000).toFixed(1)} seconds` : run.status === "running" ? "In progress" : "Not recorded"}</dd><dt>Transcript</dt><dd>{run.transcript.length} turns</dd><dt>Channel</dt><dd>{context?.transport ?? "Not captured on this older run"}</dd>
        {run.externalCallId && <><dt>{context?.transport === "bland-chat" ? "Bland chat ID" : "Provider call ID"}</dt><dd className="mono">{run.externalCallId}</dd></>}
        {context?.account && <><dt>Provider account</dt><dd>{context.account.label} ({context.account.provider})</dd></>}
      </dl>
      {!run.testCaseId.startsWith("hosted:") && <Link href={`/simulations/${encodeURIComponent(run.testCaseId)}`}>Open simulation →</Link>}
      {run.error && <p role="alert" style={{ color: "var(--fail)", whiteSpace: "pre-wrap" }}>{run.error}</p>}
      {run.status === "running" && run.externalCallId && context?.account && <HostedRunWatcher runId={id} />}
      {(run.status === "running" || run.status === "errored" || retryJudgeError) && run.externalCallId && context?.account && context.transport !== "bland-chat" && <CheckHostedCall runId={id} retryEvaluation={retryJudgeError} />}
      {run.externalCallId && context?.transport !== "bland-chat" && <SyncSavedRun runId={id} />}
    </section>
    {run.metrics && <section className="card"><h2 style={{ marginTop: 0 }}>Run metrics</h2><dl className="run-facts">
      <dt>Testing agent turns</dt><dd>{run.metrics.agentTurns}</dd><dt>Target turns</dt><dd>{run.metrics.targetTurns}</dd>
      <dt>Average target words</dt><dd>{run.metrics.avgTargetWords}</dd><dt>Target latency</dt><dd>{run.metrics.targetLatency ? `${run.metrics.targetLatency.avg} ms average · ${run.metrics.targetLatency.p95} ms p95` : "Not measured"}</dd>
    </dl><div>{(run.labels ?? []).map((l, i) => <span key={i} className={`label label-${l.tone}`}>{l.text}</span>)}</div></section>}
    {context?.transport !== "bland-chat" && <RunAudio runId={id} recording={run.recording} canDownload={canDownload} needsAccount={!context?.account && !run.recordingSource && !primaryCall && run.recording?.status !== "available"} accounts={recordingAccounts} />}
    <section><h2>Agents used for this run</h2>{context ? <div className="run-agents"><Agent title="Testing agent" agent={context.testingAgent} /><Agent title="Main agent" agent={context.targetAgent} /></div> : <p className="card muted">Agent snapshots were not captured for this older run. Current agent settings may differ from those used at the time.</p>}</section>
    <section><h2>Judges</h2><div className="judge-cards">
      <article className="card"><p className="field-label">Original evaluation</p><h3>Overall verdict</h3>{run.verdict ? <VerdictAssessment verdict={run.verdict} /> : <p className="muted">{run.status === "running" ? "The call will be evaluated when its transcript is ready." : "No original judge verdict was saved."}</p>}</article>
      {context?.judges.map((judge, index) => <article className="card" key={`${judge.id}-${index}`}><p className="field-label">Attached judge · {judge.kind}</p><h3>{judge.name}</h3>{judge.description && <p>{judge.description}</p>}{judgeSignals && hasSignals(judgeSignals.attached[index]!) ? <><p className="muted">Checks and metrics from the original combined evaluation.</p><VerdictSignals signals={judgeSignals.attached[index]!} /></> : <p className="muted">{run.verdict ? "No original checks or metrics could be attributed to this judge." : "Results will appear when the call is evaluated."}</p>}<JudgeConfiguration spec={judge.spec} /></article>)}
      {judgeSignals && hasSignals(judgeSignals.simulation) && <article className="card"><p className="field-label">Original evaluation</p><h3>Simulation checks</h3><VerdictSignals signals={judgeSignals.simulation} /></article>}
      {judgeSignals && hasSignals(judgeSignals.unassigned) && <article className="card"><p className="field-label">Original evaluation</p><h3>Other checks and metrics</h3><p className="muted">These results could not be assigned to one saved judge from this run’s snapshot.</p><VerdictSignals signals={judgeSignals.unassigned} /></article>}
      {run.liveChecks.length > 0 && <article className="card"><p className="field-label">During the call</p><h3>Live checks</h3>{run.liveChecks.map((check, index) => <p key={index}>{check.passed ? "PASS" : "FAIL"} · {check.description}{check.detail ? ` — ${check.detail}` : ""}</p>)}</article>}
      {[...(run.evaluations ?? [])].reverse().map((evaluation) => <article className="card" key={evaluation.id}><p className="field-label">Additional evaluation</p><h3>{evaluation.judge.name}</h3><p className="muted">{new Date(evaluation.createdAt).toLocaleString()} · {evaluation.provider || "Provider unavailable"} / {evaluation.model || "default"}</p>{evaluation.error && <p style={{ color: "var(--fail)" }}>{evaluation.error}</p>}{evaluation.verdict && <Verdict verdict={evaluation.verdict} />}<JudgeConfiguration spec={evaluation.judge.spec} /></article>)}
    </div></section>
    <ApplyRunJudges runId={id} judges={listJudges()} hasTranscript={run.transcript.length > 0} />
    <HalMessageCheck run={run} />
    <RunActivityTimeline run={run} primarySide={primarySide} />
    {(run.externalCallId || run.providerCalls) && <section className="card"><h2 style={{ marginTop: 0 }}>Provider call metadata</h2>
      <p className="muted">HAL fetches the dispatched agent’s call record automatically. It also looks for the receiving agent’s separate call record; a history sync refreshes both linked records. If the receiving call cannot be matched, add its call ID below.</p>
      {(["testingAgent", "targetAgent"] as const).map((side) => {
        const snapshot = run.providerCalls?.[side];
        const agent = context?.[side];
        const dispatchedSide = context?.targetAgent.direction === "outbound" ? "targetAgent" : "testingAgent";
        return <div key={side} style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
          <h3>{side === "testingAgent" ? "HAL testing agent" : "Main agent"}</h3>
          {snapshot ? <><p className="muted mono">{snapshot.provider} · {snapshot.externalCallId} · fetched {new Date(snapshot.fetchedAt).toLocaleString()}</p>
            {callFacts(snapshot.details).length > 0 && <p className="muted">{callFacts(snapshot.details).join(" · ")}</p>}
            <p className="muted">{snapshot.events?.length ?? 0} provider events captured. Full response and event data are in the JSON below.</p>
          </> : <p className="muted">{side === dispatchedSide ? "Call details will appear after the next status check." : "No separate provider record linked yet."}</p>}
          <AttachProviderCall runId={id} side={side} provider={agent?.provider} callId={snapshot?.externalCallId ?? (side === dispatchedSide ? run.externalCallId : undefined)} accounts={providerAccounts} />
        </div>;
      })}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 18, marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>Provider metadata JSON</h3>
        <p className="muted">Choose the HAL testing agent, the main agent, or both. Each view includes that agent’s call record, message metadata, and all tool, node, and provider events. Copy the selected JSON for debugging or sharing.</p>
        <MetadataJsonViewer views={[...metadataViews, fullMetadataView]} />
      </div>
    </section>}
  </div>;
}
