import TestingAgentsManager from "@/components/TestingAgentsManager";
import PageIntro from "@/components/PageIntro";

export const dynamic = "force-dynamic";

export default function TestingAgentsPage() {
  return (
    <>
      <PageIntro number="06" section="Test callers" title="Testing agents">
        Import a <strong>testing agent you already built</strong> or create a new one on a connected
        provider. Imported testers use their existing configuration; HAL-created testers use the
        saved simulation script for each run.
      </PageIntro>
      <TestingAgentsManager />
    </>
  );
}
