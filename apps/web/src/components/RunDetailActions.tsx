"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { RunRecording, SavedJudge } from "@hal/core";

export function RunAudio({ runId, recording, canDownload, needsAccount, accounts }: {
  runId: string; recording?: RunRecording; canDownload: boolean; needsAccount: boolean;
  accounts: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const url = `/api/results/${encodeURIComponent(runId)}/recording`;
  async function download() {
    setBusy(true); setError(undefined);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Recording download failed.");
      router.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="card">
    <div className="card-row"><h2 style={{ margin: 0 }}>Call recording</h2><span className="label label-neutral">Local audio</span></div>
    {recording?.status === "available" ? <>
      <audio key={recording.downloadedAt} controls preload="metadata" src={url} style={{ width: "100%", marginTop: 16 }} onError={() => setError("Local audio could not be played. Try downloading it again.")} />
      <p className="muted">Saved on this device · {((recording.bytes ?? 0) / 1024 / 1024).toFixed(1)} MB · <a href={`${url}?download=1`} download>Save a copy</a></p>
    </> : <p className="muted">{recording?.error ?? (canDownload ? "Download the Bland recording to listen on this device. New Bland runs download automatically when the recording is ready." : "No downloadable Bland recording is associated with this run.")}</p>}
    {canDownload && <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
      {needsAccount && <label className="field">Bland account for this older call
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Select account</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </label>}
      <button className="secondary" onClick={download} disabled={busy || (needsAccount && !accountId)}>{busy ? "Downloading…" : recording?.status === "available" ? "Check local recording" : "Download recording"}</button>
    </div>}
    {error && <p role="alert" style={{ color: "var(--fail)" }}>{error}</p>}
  </section>;
}

export function ApplyRunJudges({ runId, judges, hasTranscript }: { runId: string; judges: SavedJudge[]; hasTranscript: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function apply() {
    setBusy(true); setError(undefined);
    try {
      const res = await fetch(`/api/results/${encodeURIComponent(runId)}/score`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ judgeIds: selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Evaluation failed.");
      setSelected([]); router.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="card">
    <div className="card-row"><h2 style={{ margin: 0 }}>Apply additional judges</h2><Link href="/judges">Manage judges →</Link></div>
    <p className="muted">Evaluate the saved transcript without making another call. Each judge gets its own result; the original run verdict stays unchanged. AI judges use your configured LLM provider.</p>
    {!hasTranscript ? <p className="muted">This run has no transcript to evaluate.</p> : judges.length === 0 ? <p>No saved judges yet. Create one in Judges, then return here.</p> : <>
      <div className="grid" style={{ gap: 8 }}>
        {judges.map((j) => <label className="card-row" key={j.id} style={{ justifyContent: "flex-start", gap: 12 }}>
          <input type="checkbox" style={{ width: "auto" }} disabled={busy || (!selected.includes(j.id) && selected.length >= 10)} checked={selected.includes(j.id)} onChange={(e) => setSelected((s) => e.target.checked ? [...s, j.id] : s.filter((id) => id !== j.id))} />
          <span><strong>{j.name}</strong> <span className="label label-neutral">{j.kind}</span>{j.description && <span className="muted"> — {j.description}</span>}</span>
        </label>)}
      </div>
      <button style={{ marginTop: 16 }} disabled={busy || !selected.length} onClick={apply}>{busy ? "Evaluating…" : `Apply ${selected.length || "selected"} judge${selected.length === 1 ? "" : "s"}`}</button>
    </>}
    {error && <p role="alert" style={{ color: "var(--fail)" }}>{error}</p>}
  </section>;
}
