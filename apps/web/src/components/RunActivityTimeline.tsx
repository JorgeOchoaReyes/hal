"use client";

import React, { useMemo, useRef, useState } from "react";
import type { RunTraceEvent, TestResult, Utterance } from "@hal/core";

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

function activityTitle(event: RunTraceEvent): string {
  const data = record(event.data);
  const payload = record(data.payload);
  const node = record(data.node);
  if (event.kind === "node") {
    const name = payload.chosen_node_name ?? payload.node_name ?? node.name ?? data.node_name ?? data.name;
    return `Visited node: ${typeof name === "string" && name.trim() ? name : event.label.replace(/^Visited\s+/i, "")}`;
  }
  if (event.kind === "tool-call") return `Tool call: ${event.label}`;
  if (event.kind === "tool-result") return `Tool result: ${event.label}`;
  const type = typeof data.event_type === "string" ? data.event_type : event.label;
  return `Provider event: ${type.replace(/[._-]+/g, " ")}`;
}

function MessageMetadata({ turn, side, speaker }: { turn: Utterance; side: Side; speaker: Side }) {
  if (!turn.meta) return null;
  const facts = metadataFacts(turn.meta);
  return <details className="activity-message-meta">
    <summary>{side !== speaker ? `${sideName(side)} metadata for ${sideName(speaker).toLowerCase()} speech` : "Message metadata"}{typeof turn.meta.nodeId === "string" ? ` · node ${turn.meta.nodeId}` : ""}</summary>
    {facts.length > 0 && <p className="muted" style={{ margin: "6px 0", fontSize: 12 }}>{facts.join(" · ")}</p>}
    <pre className="run-json">{JSON.stringify(turn.meta, null, 2)}</pre>
  </details>;
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
    ...(run.trace ?? []).map((event, index) => ({ kind: "event" as const, at: event.at ?? Number.MAX_SAFE_INTEGER, order: index, event })),
  ].sort((a, b) => a.at - b.at || a.order - b.order);

  return <section className="card">
    <h2 style={{ marginTop: 0 }}>Transcript and activity</h2>
    {hasAudio && <div className="activity-audio"><audio ref={audio} key={run.recording?.downloadedAt} controls preload="metadata" aria-label="Call recording" src={`/api/results/${encodeURIComponent(run.id)}/recording`} onTimeUpdate={(event) => setPositionMs(event.currentTarget.currentTime * 1000)} onSeeked={(event) => setPositionMs(event.currentTarget.currentTime * 1000)} /><span className="muted">Play a timed message to seek in the recording.</span></div>}
    <p className="muted">Read speech by speaker. Open any activity title to see its details. Activity and message metadata sit under the provider call that captured them.</p>
    <div className="activity-head"><strong>Testing agent</strong><strong>Main agent</strong></div>
    {!entries.length ? <p className="muted">{run.status === "running" ? "Waiting for the provider transcript." : "No transcript or activity was captured."}</p>
      : <div className="activity-feed">{entries.map((item, index) => {
        if (item.kind === "event") {
          return <div className="activity-row" key={`event-${index}`}>
            <details className={`activity-entry activity-collapsible ${sideClass(item.event.side)}`}>
              <summary>{activityTitle(item.event)}</summary>
              <p className="muted" style={{ fontSize: 12 }}>{sideName(item.event.side)} activity{item.event.nodeId ? ` · node ${item.event.nodeId}` : ""}</p>
              {item.event.data && <pre className="run-json">{JSON.stringify(item.event.data, null, 2)}</pre>}
            </details>
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
  </section>;
}
