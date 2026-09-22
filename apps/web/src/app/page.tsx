import Link from "next/link";
import { listTestCases } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const testCases = listTestCases();

  return (
    <>
      <div className="card-row">
        <h1 style={{ margin: 0 }}>Simulations</h1>
        <Link href="/tests/new" className="btn">+ New simulation</Link>
      </div>
      <p className="sub">
        Point a simulated caller at a voice AI, script it turn by turn, and let the judge
        decide pass or fail. Everything below runs in <strong>mock mode</strong> with no
        credentials — add Twilio / WebRTC config to place real calls.
      </p>

      {testCases.length === 0 && (
        <div className="card muted">No test cases yet.</div>
      )}

      <div className="grid">
        {testCases.map((tc) => {
          const kind = tc.target.transport;
          return (
            <div className="card" key={tc.id}>
              <div className="card-row">
                <div>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>
                    <Link href={`/tests/${tc.id}`}>{tc.name}</Link>
                  </div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                    {tc.scenario.description ?? tc.scenario.name} · persona:{" "}
                    {tc.scenario.persona.name} · {tc.scenario.steps.length} steps
                  </div>
                  <div style={{ marginTop: 8 }}>
                    {(tc.tags ?? []).map((t) => (
                      <span className="tag" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span className={`pill ${kind}`}>{kind}</span>
                  <Link href={`/tests/${tc.id}`} className="btn">
                    Open
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <h2>How targeting works</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          HAL reaches the voice AI under test through a pluggable transport:
        </p>
        <ul className="muted">
          <li>
            <span className="pill mock">mock</span> — an in-process simulated agent (no
            calls); ideal for authoring and CI.
          </li>
          <li>
            <span className="pill telephony">telephony</span> — real PSTN calls via Twilio
            to any phone number you provide.
          </li>
          <li>
            <span className="pill webrtc">webrtc</span> — join a WebRTC room / signaling
            endpoint the target agent is on.
          </li>
          <li>
            <span className="pill sip">sip</span> — dial a SIP URI directly against your own
            PBX / trunk.
          </li>
        </ul>
      </div>
    </>
  );
}
