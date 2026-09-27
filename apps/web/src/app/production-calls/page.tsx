import ProdCalls from "@/components/ProdCalls";
import PageIntro from "@/components/PageIntro";

export const dynamic = "force-dynamic";

export default function ProductionCallsPage() {
  return (
    <>
      <PageIntro number="03" section="Real conversations" title="Production calls">
        Bring in real production calls: upload a recording to transcribe it (or paste a transcript),
        assign it to one of your agents, then apply a judge to score it — the judges attached to that
        agent are suggested automatically, or pick any judge yourself.
      </PageIntro>
      <ProdCalls />
    </>
  );
}
