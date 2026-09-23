import ProdCalls from "@/components/ProdCalls";

export const dynamic = "force-dynamic";

export default function TranscriptionsPage() {
  return (
    <>
      <h1 style={{ margin: 0 }}>Transcriptions</h1>
      <p className="sub" style={{ marginTop: 4 }}>
        Bring in real production calls: upload a recording to transcribe it (or paste a transcript),
        assign it to one of your agents, then apply a judge to score it — the same judges you use on
        simulations.
      </p>
      <ProdCalls />
    </>
  );
}
