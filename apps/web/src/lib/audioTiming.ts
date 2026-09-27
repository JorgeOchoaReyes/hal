import type { TestResult, Utterance } from "@hal/core";

/** Translate a provider transcript timestamp onto the downloaded recording. */
export function playbackOffsetMs(run: TestResult, turn: Utterance, durationMs?: number): number | undefined {
  const anchor = run.transcript.find((item) => item.audioStartMs !== undefined);
  let offset = turn.audioStartMs ?? (anchor ? anchor.audioStartMs! + turn.startedAt - anchor.startedAt : turn.startedAt - run.startedAt);
  if (!Number.isFinite(offset)) return undefined;
  if (durationMs && Number.isFinite(durationMs) && durationMs > 0) {
    const primarySide = run.context?.targetAgent.direction === "outbound" ? "targetAgent" : "testingAgent";
    const call = run.providerCalls?.[primarySide];
    if (call?.provider === "bland") {
      const rawEnd = call.details.end_at ?? call.details.ended_at;
      const endAt = typeof rawEnd === "string" ? Date.parse(rawEnd) : NaN;
      // Bland pathway events are server timestamps; its created_at can precede
      // the audio start by several seconds. Anchor them to the call end instead.
      if (Number.isFinite(endAt) && Number.isFinite(turn.startedAt)) {
        const anchored = turn.startedAt - (endAt - durationMs);
        if (anchored >= -5000 && anchored <= durationMs + 5000) offset = anchored;
      }
    }
    offset = Math.min(offset, Math.max(0, durationMs - 100));
  }
  return Math.max(0, offset);
}
