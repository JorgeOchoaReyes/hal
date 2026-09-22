import UpdateSettings from "@/components/UpdateSettings";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <>
      <h1 style={{ margin: 0 }}>Settings</h1>
      <p className="sub" style={{ marginTop: 4 }}>
        App version and sync status. The desktop app checks for updates on launch and
        keeps itself in sync; you can also check or force an update here.
      </p>
      <UpdateSettings />
    </>
  );
}
