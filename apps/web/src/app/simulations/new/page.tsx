import Link from "next/link";
import SimulationForm from "@/components/SimulationForm";

export const dynamic = "force-dynamic";

export default function NewSimulationPage() {
  return (
    <>
      <p style={{ marginTop: 20 }}>
        <Link href="/">← All simulations</Link>
      </p>
      <h1>New simulation</h1>
      <p className="sub">
        Compose a test call: pick a provider template, define the caller persona, script the
        conversation turn by turn, and set the pass criteria.
      </p>
      <SimulationForm />
    </>
  );
}
