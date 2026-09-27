import { listSimulationFolders, listTestCases } from "@/lib/store";
import SimulationsTable, { type SimRow } from "@/components/SimulationsTable";
import PageIntro from "@/components/PageIntro";
import type { TestCase } from "@hal/core";

export const dynamic = "force-dynamic";

function targetLabel(tc: TestCase): string {
  const t = tc.target;
  switch (t.transport) {
    case "telephony":
      return t.phoneNumber;
    case "sip":
      return t.uri;
    case "webrtc":
      return t.room ?? t.signalingUrl;
    default:
      return "in-process";
  }
}

function metricCount(tc: TestCase): number {
  const j = tc.judge;
  return (j.metrics?.length ?? 0) + (j.criteria?.length ?? 0) + (j.rules?.length ?? 0);
}

function stepCount(tc: TestCase): number {
  return tc.scenario.structured
    ? tc.scenario.structured.conditions.length
    : tc.scenario.steps.length;
}

export default function DashboardPage() {
  const rows: SimRow[] = listTestCases().map((tc) => ({
    id: tc.id,
    name: tc.name,
    persona: tc.scenario.persona.name,
    transport: tc.target.transport,
    target: targetLabel(tc),
    steps: stepCount(tc),
    metrics: metricCount(tc),
    tags: tc.tags ?? [],
    folderId: tc.folderId,
  }));

  return (
    <>
      <PageIntro number="01" section="Simulation workspace" title="Simulations" stats={[
        { label: "Saved scenarios", value: rows.length },
        { label: "Scripted steps", value: rows.reduce((sum, row) => sum + row.steps, 0) },
        { label: "Evaluation checks", value: rows.reduce((sum, row) => sum + row.metrics, 0) },
      ]}>
        Test scenarios that drive a simulated caller against a voice AI, each with a
        persona and the metrics it should pass.
      </PageIntro>

      <SimulationsTable rows={rows} folders={listSimulationFolders()} />

      <details className="card" style={{ marginTop: 18 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>How targeting works</summary>
        <ul className="muted" style={{ marginBottom: 0 }}>
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
      </details>
    </>
  );
}
