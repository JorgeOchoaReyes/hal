import TargetsManager from "@/components/TargetsManager";
import PageIntro from "@/components/PageIntro";

export const dynamic = "force-dynamic";

export default function TargetsPage() {
  return (
    <>
      <PageIntro number="04" section="Agents under test" title="My agents">
        The real voice agents you&apos;re testing. Register each one here — with its channel and
        address — and your simulations call them. One agent can be reused across many simulations.
      </PageIntro>
      <TargetsManager />
    </>
  );
}
