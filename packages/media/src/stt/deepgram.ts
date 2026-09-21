import { SpeechToText, STTStream, TranscriptChunk } from "@hal/core";

export interface DeepgramSTTOptions {
  apiKey?: string;
  model?: string;
  language?: string;
  /** Emit interim (non-final) hypotheses too. Default false. */
  interimResults?: boolean;
  /** Silence (ms) that finalizes an utterance. */
  endpointingMs?: number;
}

/**
 * Streaming speech-to-text over Deepgram's realtime WebSocket API.
 *
 * Auth uses the token subprotocol (`['token', <key>]`) so it works with the
 * standard global WebSocket, which cannot set request headers. Twilio μ-law is
 * fed through unchanged (encoding=mulaw, sample_rate=8000), avoiding any codec
 * in the hot path.
 */
export class DeepgramSTT implements SpeechToText {
  readonly name = "deepgram";
  private readonly apiKey: string;
  private readonly opts: DeepgramSTTOptions;

  constructor(opts: DeepgramSTTOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.DEEPGRAM_API_KEY ?? "";
    this.opts = opts;
  }

  async open(streamOpts: { sampleRate: number; encoding: string }): Promise<STTStream> {
    if (!this.apiKey) throw new Error("DEEPGRAM_API_KEY is not set");

    const params = new URLSearchParams({
      encoding: streamOpts.encoding,
      sample_rate: String(streamOpts.sampleRate),
      model: this.opts.model ?? "nova-2-phonecall",
      language: this.opts.language ?? "en",
      punctuate: "true",
      interim_results: String(this.opts.interimResults ?? false),
      endpointing: String(this.opts.endpointingMs ?? 300),
    });
    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    const ws = new WebSocket(url, ["token", this.apiKey]);
    return new DeepgramStream(ws);
  }
}

class DeepgramStream implements STTStream {
  private handlers: Array<(chunk: TranscriptChunk) => void> = [];
  private ready: Promise<void>;
  private pending: Uint8Array[] = [];
  private open = true;

  constructor(private readonly ws: WebSocket) {
    ws.binaryType = "arraybuffer";
    this.ready = new Promise<void>((resolve) => {
      ws.addEventListener("open", () => {
        for (const frame of this.pending) ws.send(frame);
        this.pending = [];
        resolve();
      });
    });

    ws.addEventListener("message", (ev: MessageEvent) => {
      let data: unknown;
      try {
        data = JSON.parse(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer));
      } catch {
        return;
      }
      const msg = data as {
        type?: string;
        is_final?: boolean;
        channel?: { alternatives?: Array<{ transcript?: string; confidence?: number }> };
      };
      if (msg.type && msg.type !== "Results") return;
      const alt = msg.channel?.alternatives?.[0];
      const text = alt?.transcript ?? "";
      if (!text) return;
      const chunk: TranscriptChunk = {
        text,
        final: Boolean(msg.is_final),
        confidence: alt?.confidence,
        startedAt: Date.now(),
        endedAt: Date.now(),
      };
      for (const h of this.handlers) h(chunk);
    });
  }

  write(frame: Uint8Array): void {
    if (!this.open) return;
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(frame);
    else this.pending.push(frame);
  }

  onChunk(handler: (chunk: TranscriptChunk) => void): void {
    this.handlers.push(handler);
  }

  async close(): Promise<void> {
    this.open = false;
    await this.ready.catch(() => undefined);
    try {
      // Deepgram's graceful close message.
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "CloseStream" }));
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}
