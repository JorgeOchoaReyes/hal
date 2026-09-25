import TestingAgentsManager from "@/components/TestingAgentsManager";

export const dynamic = "force-dynamic";

export default function TestingAgentsPage() {
  return (
    <>
      <h1 style={{ margin: 0 }}>Testing agents</h1>
      <p className="sub" style={{ marginTop: 4 }}>
        HAL keeps <strong>reusable testing agents</strong> on your connected provider accounts —
        the callers it uses to run your simulations — and reconfigures them for each run.
        Provisioning edits that same agent.
      </p>
      <TestingAgentsManager />
    </>
  );
}
