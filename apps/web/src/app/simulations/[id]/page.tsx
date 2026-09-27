import Link from "next/link";
import { notFound } from "next/navigation";
import { getSimulationFolder, getTestCase, getTarget, listResults } from "@/lib/store";
import { mainOpeningMessage } from "@/lib/openingMessages";
import OpeningMessageWarning from "@/components/OpeningMessageWarning";
import ScenarioEditor from "@/components/ScenarioEditor";
import RunPanel from "@/components/RunPanel";
import DispatchHosted from "@/components/DispatchHosted";
import AttachJudges from "@/components/AttachJudges";
import type { JudgeRule, Target } from "@hal/core";

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
  const folder = tc.folderId ? getSimulationFolder(tc.folderId) : undefined;
  const mainMessage = mainOpeningMessage(tc.target, tc.targetAgentId ? getTarget(tc.targetAgentId) : undefined);

  return (
    <>
      <header className="detail-intro">
        <Link href="/" className="detail-back">← All simulations</Link>
        <div className="card-row">
          <h1 style={{ margin: 0 }}>{tc.name}</h1>
          <span className={`pill ${tc.target.transport}`}>{tc.target.transport}</span>
          {folder && <span className="pill">▸ {folder.name}</span>}
        </div>
        <p className="sub">{tc.scenario.description}</p>
      </header>

      <h2>Run this simulation</h2>
      {tc.target.transport === "mock" && <OpeningMessageWarning scenario={tc.scenario} mainMessage={mainMessage} />}
      <RunPanel testCaseId={tc.id} />
      <div style={{ marginTop: 12 }}>
        <DispatchHosted testCaseId={tc.id} scenario={tc.scenario} />
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

      <ScenarioEditor testCaseId={tc.id} initial={tc.scenario} mainMessage={mainMessage} />

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
    case "bland-chat": return `Bland chat · pathway ${target.pathwayId}`;
    case "hosted-chat": return `${target.provider} chat · agent ${target.externalAgentId}`;
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
