"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ProdCall, SavedJudge, TargetAgent } from "@hal/core";
import Modal from "./Modal";

const STATUS_TONE: Record<ProdCall["status"], string> = {
  new: "neutral",
  transcribing: "info",
  scored: "pass",
  error: "fail",
};

export default function ProdCalls() {
  const [calls, setCalls] = useState<ProdCall[]>([]);
  const [judges, setJudges] = useState<SavedJudge[]>([]);
  const [targets, setTargets] = useState<TargetAgent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [c, j, t] = await Promise.all([
      fetch("/api/prod-calls").then((r) => r.json()),
      fetch("/api/judges").then((r) => r.json()),
      fetch("/api/targets").then((r) => r.json()),
    ]);
    setCalls(c.prodCalls ?? []);
    setJudges(j.judges ?? []);
    setTargets(t.targets ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoaded(true));
  }, [refresh]);

  return (
    <>
      <div className="toolbar" style={{ margin: "4px 0 0" }}>
        <div className="muted" style={{ fontSize: 13 }}>
          {calls.length} call{calls.length === 1 ? "" : "s"}
        </div>
        <button onClick={() => setUploadOpen(true)}>+ Add call</button>
      </div>

      {loaded && calls.length === 0 && (
        <div className="card muted">
          No production calls yet. Upload a recording to transcribe it, or paste a transcript, then
          apply a judge to score it.
        </div>
      )}

      <div className="grid stagger" style={{ gap: 12 }}>
        {calls.map((call) => (
          <CallCard
            key={call.id}
            call={call}
            judges={judges}
            targets={targets}
            onChange={refresh}
          />
        ))}
      </div>

      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="Add a production call" wide>
        <UploadForm
          targets={targets}
          onDone={() => {
            setUploadOpen(false);
            refresh();
          }}
          onCancel={() => setUploadOpen(false)}
        />
      </Modal>
    </>
  );
}

function UploadForm({
  targets,
  onDone,
  onCancel,
}: {
  targets: TargetAgent[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [tab, setTab] = useState<"audio" | "transcript">("audio");
  const [name, setName] = useState("");
  const [targetAgentId, setTargetAgentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [transcriptText, setTranscriptText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      let res: Response;
      if (tab === "audio") {
        if (!file) throw new Error("Choose an audio file to transcribe.");
        const fd = new FormData();
        fd.set("file", file);
        fd.set("name", name);
        if (targetAgentId) fd.set("targetAgentId", targetAgentId);
        res = await fetch("/api/prod-calls", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/prod-calls", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, transcriptText, targetAgentId: targetAgentId || undefined }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {err && (
        <div className="muted" style={{ color: "var(--fail)", marginBottom: 8 }}>
          {err}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          className={`icon-btn${tab === "audio" ? " active" : ""}`}
          onClick={() => setTab("audio")}
        >
          Upload audio
        </button>
        <button
          type="button"
          className={`icon-btn${tab === "transcript" ? " active" : ""}`}
          onClick={() => setTab("transcript")}
        >
          Paste transcript
        </button>
      </div>

      <label className="field">
        <span className="field-label">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Support call — Mar 12" />
      </label>

      <label className="field">
        <span className="field-label">Assign agent (optional)</span>
        <select value={targetAgentId} onChange={(e) => setTargetAgentId(e.target.value)}>
          <option value="">— none —</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      {tab === "audio" ? (
        <label className="field">
          <span className="field-label">Audio file</span>
          <input
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            Transcribed with your configured provider. Set a key under Settings → Transcription.
          </span>
        </label>
      ) : (
        <label className="field">
          <span className="field-label">Transcript</span>
          <textarea
            value={transcriptText}
            onChange={(e) => setTranscriptText(e.target.value)}
            rows={10}
            placeholder={"agent: Hi, I'd like to book an appointment.\ntarget: Sure! What day works for you?"}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            One turn per line. Prefix with <code>agent:</code> or <code>target:</code> to set the
            speaker; otherwise turns alternate.
          </span>
        </label>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button onClick={submit} disabled={busy}>
          {busy ? (tab === "audio" ? "Transcribing…" : "Saving…") : "Add call"}
        </button>
      </div>
    </>
  );
}

function CallCard({
  call,
  judges,
  targets,
  onChange,
}: {
  call: ProdCall;
  judges: SavedJudge[];
  targets: TargetAgent[];
  onChange: () => void;
}) {
  const [judgeId, setJudgeId] = useState(call.judgeId ?? "");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const assigned = targets.find((t) => t.id === call.targetAgentId);

  async function assignAgent(id: string) {
    await fetch(`/api/prod-calls/${call.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetAgentId: id || null }),
    });
    onChange();
  }

  async function score() {
    if (!judgeId) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/prod-calls/${call.id}/score`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ judgeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scoring failed");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      onChange();
    }
  }

  async function remove() {
    await fetch(`/api/prod-calls/${call.id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="card-row">
        <div>
          <strong>{call.name}</strong> <span className={`label label-${STATUS_TONE[call.status]}`}>{call.status}</span>{" "}
          <span className="pill mock">{call.source}</span>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {new Date(call.createdAt).toLocaleString()} · {call.transcript.length} turns
            {call.transcription?.durationSec != null && ` · ${Math.round(call.transcription.durationSec)}s audio`}
          </div>
        </div>
        <div className="row-actions">
          <button className="icon-btn" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide transcript" : "Transcript"}
          </button>
          <Link className="icon-btn" href={`/simulations/new?fromCall=${call.id}`} title="Create a simulation that replays this call's caller">
            → Simulation
          </Link>
          <button className="icon-btn" onClick={remove}>
            Delete
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}>
        <label className="field" style={{ marginBottom: 0, minWidth: 200 }}>
          <span className="field-label">Assigned agent</span>
          <select value={call.targetAgentId ?? ""} onChange={(e) => assignAgent(e.target.value)}>
            <option value="">— none —</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ marginBottom: 0, minWidth: 200 }}>
          <span className="field-label">Judge</span>
          <select value={judgeId} onChange={(e) => setJudgeId(e.target.value)}>
            <option value="">— pick a judge —</option>
            {judges.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name} ({j.kind})
              </option>
            ))}
          </select>
        </label>
        <button onClick={score} disabled={busy || !judgeId}>
          {busy ? "Scoring…" : "Apply judge"}
        </button>
      </div>

      {assigned && (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Assigned to <Link href="/targets">{assigned.name}</Link>.
        </div>
      )}
      {err && (
        <div className="muted" style={{ color: "var(--fail)", marginTop: 6 }}>
          {err}
        </div>
      )}

      {call.verdict && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className={`pill ${call.verdict.passed ? "passed" : "failed"}`}>
              {call.verdict.passed ? "passed" : "failed"}
            </span>
            <span className="muted">score {Math.round(call.verdict.score * 100)}%</span>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 6, marginBottom: 6 }}>
            {call.verdict.summary}
          </p>
          {call.verdict.checks.length > 0 && (
            <ul className="checks">
              {call.verdict.checks.map((c) => (
                <li key={c.id} className={c.passed ? "pass" : "fail"}>
                  <span className="mark">{c.passed ? "▸" : "✕"}</span>
                  <span>
                    {c.description}
                    {c.detail && <span className="detail"> — {c.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {open && (
        <div className="transcript" style={{ marginTop: 12 }}>
          {call.transcript.map((u, i) => (
            <div key={i} className={`turn ${u.role}`}>
              <div className="who">{u.role}</div>
              <div>{u.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
