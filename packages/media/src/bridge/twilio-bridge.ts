import { MediaBridge, Utterance, SpeechToText, TextToSpeech, STTStream, sleep } from "@hal/core";

/**
 * The minimal socket surface the bridge needs. Node's `ws` WebSocket satisfies
 * it; tests pass a fake. Keeping it structural avoids coupling core media logic
 * to a specific WebSocket implementation.
 */
export interface RawSocket {
  send(data: string): void;
  on(event: "message", cb: (data: unknown) => void): void;
  on(event: "close", cb: () => void): void;
  close(): void;
}

export interface TwilioBridgeDeps {
  stt: SpeechToText;
  tts: TextToSpeech;
  /** Frame pacing in ms (Twilio expects 20ms / 160-byte μ-law frames). */
  frameMs?: number;
}

const FRAME_BYTES = 160; // 20ms of 8kHz μ-law

/**
 * Bridges one Twilio Media Streams WebSocket to STT/TTS, exposing the core
 * `MediaBridge` contract so the telephony transport drives a real call exactly
 * like a mock one:
 *
 *   inbound  Twilio μ-law  ->  STT  ->  onTranscript(target Utterance)
 *   outbound sendSpeech()  ->  TTS  ->  μ-law frames  ->  Twilio
 */
export class TwilioMediaBridge implements MediaBridge {
  private streamSid: string | null = null;
  private callSidValue: string | null = null;
  private sttStream: STTStream | null = null;
  private readyHandlers: Array<() => void> = [];
  private transcriptHandlers: Array<(u: Utterance) => void> = [];
  private lastAgentSpeechEndedAt = Date.now();
  private closed = false;
  private partial = "";

  constructor(
    private readonly socket: RawSocket,
    private readonly deps: TwilioBridgeDeps,
  ) {
    this.socket.on("message", (data) => void this.onMessage(data));
    this.socket.on("close", () => void this.close());
  }

  onReady(handler: () => void): void {
    this.readyHandlers.push(handler);
  }

  /** The Twilio Call SID, available once the stream has started. */
  get callSid(): string | null {
    return this.callSidValue;
  }

  onTranscript(handler: (utterance: Utterance) => void): void {
    this.transcriptHandlers.push(handler);
  }

  private async onMessage(raw: unknown): Promise<void> {
    let msg: TwilioEvent;
    try {
      msg = JSON.parse(String(raw)) as TwilioEvent;
    } catch {
      return;
    }

    switch (msg.event) {
      case "start": {
        this.streamSid = msg.start?.streamSid ?? null;
        this.callSidValue = msg.start?.callSid ?? null;
        this.sttStream = await this.deps.stt.open({ sampleRate: 8000, encoding: "mulaw" });
        this.sttStream.onChunk((chunk) => {
          if (!chunk.final) {
            this.partial = chunk.text;
            return;
          }
          const text = (this.partial ? `${this.partial} ` : "") + chunk.text;
          this.partial = "";
          const startedAt = Date.now();
          this.emitTranscript({
            role: "target",
            text: text.trim(),
            startedAt,
            endedAt: startedAt,
            latencyMs: startedAt - this.lastAgentSpeechEndedAt,
            meta: { confidence: chunk.confidence, source: "deepgram" },
          });
        });
        for (const h of this.readyHandlers) h();
        break;
      }
      case "media": {
        // Twilio sends inbound (callee) audio as base64 μ-law.
        if (msg.media?.payload && this.sttStream) {
          const bytes = Buffer.from(msg.media.payload, "base64");
          this.sttStream.write(bytes);
        }
        break;
      }
      case "stop":
        await this.close();
        break;
    }
  }

  private emitTranscript(u: Utterance): void {
    for (const h of this.transcriptHandlers) h(u);
  }

  async sendSpeech(text: string): Promise<void> {
    if (this.closed || !this.streamSid) return;
    const audio = await this.deps.tts.synthesize(text, {
      encoding: "mulaw",
      sampleRate: 8000,
    });

    const frameMs = this.deps.frameMs ?? 20;
    for (let offset = 0; offset < audio.length; offset += FRAME_BYTES) {
      if (this.closed) break;
      const frame = audio.subarray(offset, offset + FRAME_BYTES);
      this.socket.send(
        JSON.stringify({
          event: "media",
          streamSid: this.streamSid,
          media: { payload: Buffer.from(frame).toString("base64") },
        }),
      );
      await sleep(frameMs);
    }
    // A mark lets us line up when playback finished; latency is measured from here.
    this.socket.send(
      JSON.stringify({ event: "mark", streamSid: this.streamSid, mark: { name: "agent-done" } }),
    );
    this.lastAgentSpeechEndedAt = Date.now();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.sttStream?.close().catch(() => undefined);
    try {
      this.socket.close();
    } catch {
      /* ignore */
    }
  }
}

interface TwilioEvent {
  event: "connected" | "start" | "media" | "stop" | "mark";
  start?: { streamSid?: string; callSid?: string; customParameters?: Record<string, string> };
  media?: { payload?: string; track?: string };
}
