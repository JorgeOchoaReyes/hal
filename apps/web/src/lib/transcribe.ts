import "server-only";
import { parseTranscript, type Transcript, type Utterance } from "@hal/core";
import { getTranscriptionSettingsRaw } from "./store";

/**
 * Transcribe an uploaded audio recording into a HAL {@link Transcript} using the
 * configured provider (currently Deepgram). Diarized speakers are mapped to
 * roles: speaker 0 is treated as the TARGET (the AI under test), everyone else
 * as the AGENT (caller), matching how simulations label the two sides.
 */
export async function transcribeAudio(
  audio: ArrayBuffer,
  contentType: string,
): Promise<{ transcript: Transcript; durationSec?: number; provider: string; model?: string }> {
  const settings = getTranscriptionSettingsRaw();
  if (settings.provider !== "deepgram") {
    throw new Error(`Transcription provider "${settings.provider}" is not supported yet.`);
  }
  const key = settings.apiKey;
  if (!key) {
    throw new Error("No Deepgram API key set. Add one under Settings → Transcription.");
  }

  const model = settings.model || "nova-2";
  const params = new URLSearchParams({
    model,
    smart_format: "true",
    diarize: "true",
    utterances: "true",
    punctuate: "true",
  });

  const res = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "content-type": contentType || "audio/wav" },
    body: Buffer.from(audio),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Deepgram returned ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as DeepgramResponse;
  const durationSec = data.metadata?.duration;
  const utterances = data.results?.utterances ?? [];

  let transcript: Transcript;
  if (utterances.length > 0) {
    const base = Date.now();
    transcript = utterances.map((u): Utterance => ({
      role: (u.speaker ?? 0) === 0 ? "target" : "agent",
      text: u.transcript,
      startedAt: base + Math.round((u.start ?? 0) * 1000),
      endedAt: base + Math.round((u.end ?? u.start ?? 0) * 1000),
      meta: { speaker: u.speaker, confidence: u.confidence },
    }));
  } else {
    // No diarized utterances — fall back to the flat transcript as one turn.
    const flat = data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
    transcript = flat
      ? [{ role: "target", text: flat, startedAt: Date.now() }]
      : [];
  }

  return { transcript, durationSec, provider: "deepgram", model };
}

interface DeepgramResponse {
  metadata?: { duration?: number };
  results?: {
    utterances?: Array<{ speaker?: number; transcript: string; start?: number; end?: number; confidence?: number }>;
    channels?: Array<{ alternatives?: Array<{ transcript?: string }> }>;
  };
}

/** Re-exported for callers in this app; the parser itself lives in @hal/core. */
export { parseTranscript } from "@hal/core";
