import Link from "next/link";
import HostedAgents from "@/components/HostedAgents";

export const dynamic = "force-dynamic";

export default function AgentsPage() {
  return (
    <>
      <p style={{ marginTop: 20 }}>
        <Link href="/">← All suites</Link>
      </p>
      <h1>Hosted testing agents</h1>
      <p className="sub">
        Connect a voice platform (Vapi, ElevenLabs) with your own credentials. HAL creates a testing
        agent on that platform on your behalf, stores it, and uses it to place real test calls to a
        target number — then judges the transcript.
      </p>
      <HostedAgents />
    </>
  );
}
