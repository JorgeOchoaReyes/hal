import { listResults, listTestCases } from "@/lib/store";
import ResultsTable, { type ResultRow } from "@/components/ResultsTable";

export const dynamic = "force-dynamic";

export default function ResultsPage() {
  const cases = new Map(listTestCases().map((tc) => [tc.id, tc]));

  const rows: ResultRow[] = listResults().map((r) => {
    const tc = cases.get(r.testCaseId);
    return {
      id: r.id,
      testCaseId: r.testCaseId,
      simName: tc?.name ?? r.testCaseId,
      transport: tc?.target.transport ?? "mock",
      status: r.status,
      startedAt: r.startedAt,
      durationMs: r.endedAt ? r.endedAt - r.startedAt : undefined,
      turns: r.transcript?.length ?? 0,
      score: r.verdict?.score,
      labels: (r.labels ?? []).map((l) => ({ text: l.text, tone: l.tone })),
    };
  });

  return (
    <>
      <div className="card-row" style={{ marginTop: 28 }}>
        <div>
          <h1 style={{ margin: 0 }}>Results</h1>
          <p className="sub" style={{ margin: "4px 0 0" }}>
            Every run across all simulations, newest first — status, verdict score, and the
            labels the judge assigned. Click a simulation to open its detail and full transcript.
          </p>
        </div>
      </div>

      <ResultsTable rows={rows} />
    </>
  );
}
