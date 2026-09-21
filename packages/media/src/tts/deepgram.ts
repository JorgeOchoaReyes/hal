import { TextToSpeech } from "@hal/core";

export interface DeepgramTTSOptions {
  apiKey?: string;
  model?: string;
}

/**
 * Text-to-speech via Deepgram Aura. Requests μ-law/8 kHz with no container so
 * the returned bytes are raw PCMU frames ready to hand straight to Twilio Media
 * Streams — no re-encoding needed.
 */
export class DeepgramTTS implements TextToSpeech {
  readonly name = "deepgram-aura";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts: DeepgramTTSOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.DEEPGRAM_API_KEY ?? "";
    this.model = opts.model ?? "aura-asteria-en";
  }

  async synthesize(
    text: string,
    opts: { voice?: string; encoding?: string; sampleRate?: number } = {},
  ): Promise<Uint8Array> {
    if (!this.apiKey) throw new Error("DEEPGRAM_API_KEY is not set");

    const params = new URLSearchParams({
      model: opts.voice ?? this.model,
      encoding: opts.encoding ?? "mulaw",
      sample_rate: String(opts.sampleRate ?? 8000),
      container: "none",
    });

    const res = await fetch(`https://api.deepgram.com/v1/speak?${params.toString()}`, {
      method: "POST",
      headers: {
        authorization: `Token ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Deepgram TTS failed (${res.status}): ${body}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }
}
