"use client";

import React, { useMemo, useRef, useState } from "react";
import type { TestResult, Utterance } from "@hal/core";

type Side = "testingAgent" | "targetAgent";

const sideName = (side: Side) => side === "testingAgent" ? "Testing agent" : "Main agent";
const sideClass = (side: Side) => side === "testingAgent" ? "activity-left" : "activity-right";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function metadataFacts(meta: Record<string, unknown>): string[] {
  const payload = record(meta.payload);
  return [
    typeof meta.nodeId === "string" ? `node ${meta.nodeId}` : undefined,
    typeof meta.sequence === "number" ? `event #${meta.sequence}` : undefined,
    typeof meta.confidence === "number" ? `${Math.round(meta.confidence * 100)}% confidence` : undefined,
    typeof meta.secondsFromStart === "number" ? `+${meta.secondsFromStart.toFixed(1)}s` : undefined,
    typeof meta.time_in_call_secs === "number" ? `+${meta.time_in_call_secs.toFixed(1)}s` : undefined,
    typeof payload.tool_name === "string" ? `tool ${payload.tool_name}` : undefined,
    typeof payload.status === "string" ? payload.status : undefined,
  ].filter((item): item is string => Boolean(item));
}

function activityPayload(data?: Record<string, unknown>): string | undefined {
  const payload = record(data?.payload);
  const useful = Object.keys(payload).length ? payload : record(data?.arguments ?? data?.result);
  if (!Object.keys(useful).length) return undefined;
  const json = JSON.stringify(useful);
  return json.length > 360 ? `${json.slice(0, 360)}…` : json;
}

function MessageMetadata({ turn, side, speaker }: { turn: Utterance; side: Side; speaker: Side }) {
  if (!turn.meta) return null;
  const facts = metadataFacts(turn.meta);
  return <div className="activity-message-meta">
    {side !== speaker && <p className="activity-meta-source">{sideName(side)} call metadata for {sideName(speaker).toLowerCase()} speech</p>}
    {facts.length > 0 && <p className="muted" style={{ margin: "6px 0", fontSize: 12 }}>{facts.join(" · ")}</p>}
    <details><summary>Message metadata</summary><pre className="run-json">{JSON.stringify(turn.meta, null, 2)}</pre></details>
  </div>;
}

export default function RunActivityTimeline({ run, primarySide }: { run: TestResult; primarySide: Side }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [positionMs, setPositionMs] = useState(0);
  const timed = useMemo(() => run.transcript.map((turn, index) => ({ index, at: turn.audioStartMs }))
    .filter((item): item is { index: number; at: number } => typeof item.at === "number")
    .sort((a, b) => a.at - b.at), [run.transcript]);
  const activeIndex = timed.reduce((current, item) => item.at <= positionMs ? item.index : current, -1);
  const hasAudio = run.recording?.status === "available";
  function playAt(startMs: number) {
    if (!audio.current) return;
    audio.current.currentTime = startMs / 1000;
    setPositionMs(startMs);
    void audio.current.play();
  }
  const entries = [
    ...run.transcript.map((turn, index) => ({ kind: "speech" as const, at: turn.startedAt, order: index, turn })),
    ...(run.trace ?? []).filter((event) => event.kind !== "event")
      .map((event, index) => ({ kind: "event" as const, at: event.at ?? Number.MAX_SAFE_INTEGER, order: index, event })),
  ].sort((a, b) => a.at - b.at || a.order - b.order);
  const other = (run.trace ?? []).filter((event) => event.kind === "event");

  return <section className="card">
    <h2 style={{ marginTop: 0 }}>Transcript and activity</h2>
    {hasAudio && <div className="activity-audio"><audio ref={audio} key={run.recording?.downloadedAt} controls preload="metadata" aria-label="Call recording" src={`/api/results/${encodeURIComponent(run.id)}/recording`} onTimeUpdate={(event) => setPositionMs(event.currentTarget.currentTime * 1000)} onSeeked={(event) => setPositionMs(event.currentTarget.currentTime * 1000)} /><span className="muted">Play a timed message to seek in the recording.</span></div>}
    <p className="muted">Speech appears under the agent who spoke. Provider activity and message metadata appear under the call that captured them.</p>
    <div className="activity-head"><strong>Testing agent</strong><strong>Main agent</strong></div>
    {!entries.length ? <p className="muted">{run.status === "running" ? "Waiting for the provider transcript." : "No transcript or activity was captured."}</p>
      : <div className="activity-feed">{entries.map((item, index) => {
        if (item.kind === "event") {
          const payload = activityPayload(item.event.data);
          return <div className="activity-row" key={`event-${index}`}>
            <div className={`activity-entry ${sideClass(item.event.side)}`}>
              <div className="activity-who">{sideName(item.event.side)} · {item.event.kind}</div>
              <div>{item.event.label}{item.event.nodeId && <span className="muted mono"> · node {item.event.nodeId}</span>}</div>
              {payload && <p className="muted mono" style={{ overflowWrap: "anywhere", margin: "8px 0 0", fontSize: 12 }}>{payload}</p>}
              {item.event.data && <details><summary>Event metadata</summary><pre className="run-json">{JSON.stringify(item.event.data, null, 2)}</pre></details>}
            </div>
          </div>;
        }
        const turn = item.turn;
        if (turn.role === "system") return <div className="activity-row" key={`speech-${index}`}><div className="activity-entry activity-wide"><div className="activity-who">System</div>{turn.text}</div></div>;
        const speaker: Side = turn.role === "agent" ? "testingAgent" : "targetAgent";
        const source: Side = turn.metadataSource ?? (turn.meta ? primarySide : speaker);
        return <div className="activity-row" key={`speech-${index}`}>
          <div className={`activity-entry ${sideClass(speaker)}${hasAudio && item.order === activeIndex ? " activity-active" : ""}`}>
            <div className="activity-who">{sideName(speaker)} · speech</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{turn.text}</div>
            {turn.audioStartMs !== undefined && <div style={{ marginTop: 8 }}><button type="button" className="secondary sm" disabled={!hasAudio} aria-label={`Play ${sideName(speaker).toLowerCase()} message at ${(turn.audioStartMs / 1000).toFixed(1)} seconds`} onClick={() => playAt(turn.audioStartMs!)}>▶ {(turn.audioStartMs / 1000).toFixed(1)}s</button></div>}
            {source === speaker && <MessageMetadata turn={turn} side={source} speaker={speaker} />}
          </div>
          {turn.meta && source !== speaker && <div className={`activity-entry ${sideClass(source)}`}><MessageMetadata turn={turn} side={source} speaker={speaker} /></div>}
        </div>;
      })}</div>}
    {other.length > 0 && <div className="activity-row" style={{ marginTop: 12 }}>{(["testingAgent", "targetAgent"] as const).map((side) => {
      const events = other.filter((event) => event.side === side);
      return events.length ? <details className={`activity-entry ${sideClass(side)}`} key={side}>
        <summary>Other {sideName(side).toLowerCase()} provider events ({events.length})</summary>
        <pre className="run-json">{JSON.stringify(events, null, 2)}</pre>
      </details> : null;
    })}</div>}
  </section>;
}
