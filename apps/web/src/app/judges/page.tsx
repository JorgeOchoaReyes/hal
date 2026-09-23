import JudgesManager from "@/components/JudgesManager";

export const dynamic = "force-dynamic";

export default function JudgesPage() {
  return (
    <>
      <h1 style={{ margin: 0 }}>Judges</h1>
      <p className="sub" style={{ marginTop: 4 }}>
        Reusable scorers you attach to simulations and apply to uploaded production calls. A judge
        can use <strong>LLM criteria</strong>, deterministic <strong>code checks</strong>, or both —
        analyzing the transcript and call details to decide pass/fail.
      </p>
      <JudgesManager />
    </>
  );
}
