import UpdateSettings from "@/components/UpdateSettings";
import TranscriptionSettings from "@/components/TranscriptionSettings";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <>
      <h1 style={{ margin: 0 }}>Settings</h1>
      <p className="sub" style={{ marginTop: 4 }}>
        Integrations and app updates. Add a transcription provider to score production calls, and
        keep the desktop app in sync.
      </p>

      <h2 style={{ marginTop: 8 }}>Integrations</h2>
      <TranscriptionSettings />

      <h2>App</h2>
      <UpdateSettings />
    </>
  );
}
