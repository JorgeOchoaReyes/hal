"use client";

import { useSecretVisibility } from "./SecretVisibilityContext";

export default function CredentialVisibilitySettings() {
  const { visible, setVisible } = useSecretVisibility();
  return (
    <section className="card visibility-setting">
      <div>
        <span className="section-eyebrow">Display preference</span>
        <h2>Credential visibility</h2>
        <p className="muted">Show saved keys and new credential inputs in this browser. Turn it off to hide their values again.</p>
      </div>
      <button type="button" className={visible ? "secondary" : ""} onClick={() => setVisible(!visible)} aria-pressed={visible}>
        {visible ? "Hide credentials" : "Show credentials"}
      </button>
    </section>
  );
}
