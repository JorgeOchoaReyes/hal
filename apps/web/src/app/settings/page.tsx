import UpdateSettings from "@/components/UpdateSettings";
import TranscriptionSettings from "@/components/TranscriptionSettings";
import SecretsSettings from "@/components/SecretsSettings";
import PageIntro from "@/components/PageIntro";
import CredentialVisibilitySettings from "@/components/CredentialVisibilitySettings";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <>
      <PageIntro number="08" section="Workspace" title="Settings">
        Integrations, secrets, and app updates. Configure the keys HAL needs, add a transcription
        provider to score production calls, and keep the desktop app in sync.
      </PageIntro>

      <CredentialVisibilitySettings />

      <h2 style={{ marginTop: 8 }}>Integrations</h2>
      <TranscriptionSettings />

      <h2>Secrets &amp; environment</h2>
      <SecretsSettings />

      <h2>App</h2>
      <UpdateSettings />
    </>
  );
}
