import TargetsManager from "@/components/TargetsManager";

export const dynamic = "force-dynamic";

export default function TargetsPage() {
  return (
    <>
      <h1 style={{ margin: 0 }}>My agents</h1>
      <p className="sub" style={{ marginTop: 4 }}>
        The real voice agents you&apos;re testing. Register each one here — with its channel and
        address — and your simulations call them. One agent can be reused across many simulations.
      </p>
      <TargetsManager />
    </>
  );
}
