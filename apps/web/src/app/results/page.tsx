import { listResults, listTestCases } from "@/lib/store";
import ResultsTable, { type ResultRow } from "@/components/ResultsTable";
import PageIntro from "@/components/PageIntro";

export const dynamic = "force-dynamic";

export default function ResultsPage() {
  const cases = new Map(listTestCases().map((tc) => [tc.id, tc]));

  const rows: ResultRow[] = listResults().map((r) => {
    const tc = cases.get(r.testCaseId);
    return {
      id: r.id,
      testCaseId: r.testCaseId,
      simName: r.context?.simulationName ?? tc?.name ?? r.testCaseId,
      transport: r.context?.transport ?? tc?.target.transport ?? "unknown",
      status: r.status,
      startedAt: r.startedAt,
      durationMs: r.endedAt ? r.endedAt - r.startedAt : undefined,
      turns: r.transcript?.length ?? 0,
      score: r.verdict?.score,
      labels: (r.labels ?? []).map((l) => ({ text: l.text, tone: l.tone })),
      runLabel: r.runLabel,
    };
  });

  return (
    <>
      <PageIntro number="02" section="Run history" title="Results" stats={[
        { label: "Total runs", value: rows.length },
        { label: "Passed", value: rows.filter((row) => row.status === "passed").length },
        { label: "Needs review", value: rows.filter((row) => row.status === "failed" || row.status === "errored").length },
      ]}>
        Every run across all simulations, newest first — status, verdict score, and the
        labels the judge assigned. Give a run a label when you start it (or a batch of them)
        to find it again here. Open a run to review its audio, transcript, agents, and judge evaluations.
      </PageIntro>

      <ResultsTable rows={rows} />
    </>
  );
}
