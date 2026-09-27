import JudgesManager from "@/components/JudgesManager";
import PageIntro from "@/components/PageIntro";

export const dynamic = "force-dynamic";

export default function JudgesPage() {
  return (
    <>
      <PageIntro number="07" section="Evaluation" title="Judges">
        Reusable scorers you attach to simulations and apply to uploaded production calls. A judge
        can use <strong>LLM criteria</strong>, deterministic <strong>code checks</strong>, or both —
        analyzing the transcript and call details to decide pass/fail.
      </PageIntro>
      <JudgesManager />
    </>
  );
}
