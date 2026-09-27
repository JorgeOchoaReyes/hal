import HostedAgents from "@/components/HostedAgents";
import PageIntro from "@/components/PageIntro";

export const dynamic = "force-dynamic";

export default function AgentsPage() {
  return (
    <>
      <PageIntro number="05" section="Connections" title="Providers & credentials">
        Connect a voice platform (Vapi, ElevenLabs, Bland, Retell) with your own credentials.
        Once an account is connected, head to <strong>Testing agents</strong> to provision the
        callers HAL uses to run your simulations.
      </PageIntro>
      <HostedAgents />
    </>
  );
}
