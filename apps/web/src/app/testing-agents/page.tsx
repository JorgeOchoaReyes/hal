import TestingAgentsManager from "@/components/TestingAgentsManager";

export const dynamic = "force-dynamic";

export default function TestingAgentsPage() {
  return (
    <>
      <h1 style={{ margin: 0 }}>Testing agents</h1>
      <p className="sub" style={{ marginTop: 4 }}>
        Import a <strong>testing agent you already built</strong> or create a new one on a connected
        provider. Imported testers use their existing configuration; HAL-created testers use the
        saved simulation script for each run.
      </p>
      <TestingAgentsManager />
    </>
  );
}
