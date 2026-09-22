import HostedAgents from "@/components/HostedAgents";

export const dynamic = "force-dynamic";

export default function AgentsPage() {
  return (
    <>
      <h1 style={{ margin: 0 }}>Providers &amp; credentials</h1>
      <p className="sub" style={{ marginTop: 4 }}>
        Connect a voice platform (Vapi, ElevenLabs, Bland, Retell) with your own credentials. HAL
        keeps <strong>one reusable testing agent per provider</strong> — the caller it uses to run
        your simulations — and reconfigures it for each run. Re-provisioning edits that same agent.
      </p>
      <HostedAgents />
    </>
  );
}
