import HostedAgents from "@/components/HostedAgents";

export const dynamic = "force-dynamic";

export default function AgentsPage() {
  return (
    <>
      <h1 style={{ margin: 0 }}>Providers &amp; credentials</h1>
      <p className="sub" style={{ marginTop: 4 }}>
        Connect a voice platform (Vapi, ElevenLabs, Bland, Retell) with your own credentials.
        Once an account is connected, head to <strong>Testing agents</strong> to provision the
        callers HAL uses to run your simulations.
      </p>
      <HostedAgents />
    </>
  );
}
