import { MediaBridge, Utterance, SpeechToText, TextToSpeech, STTStream, sleep } from "@hal/core";
import { RawSocket } from "./twilio-bridge.js";

/**
 * A vendor-neutral WebSocket audio bridge.
 *
 * Where {@link TwilioMediaBridge} speaks Twilio's Media Streams JSON, this bridge
 * speaks a small, provider-independent protocol so that *any* media source that
 * can open a WebSocket and pump PCM can drive a HAL call. It is the shared media
 * plane for the WebRTC and SIP transports:
 *
 *   - **WebRTC**: a browser (or a WHIP/LiveKit egress) captures mic audio, and a
 *     thin client relays raw PCM16 frames over this socket. HAL does not itself
 *     terminate ICE/DTLS/SRTP — that lives in the browser or an SFU egress — the
 *     same way the Twilio bridge leans on Twilio for call control.
 *   - **SIP**: a SIP↔WS shim (FreeSWITCH `mod_audio_fork`, drachtio + rtpengine,
 *     or Jambonz) forks the RTP audio of an established SIP leg onto this socket.
 *
 * Protocol (JSON text frames):
 *   inbound  { "type": "start", "id"?: string, "sampleRate"?: number, "encoding"?: "pcm16"|"mulaw" }
 *            { "type": "audio", "payload": "<base64 audio>" }
 *            { "type": "stop" }
 *   outbound { "type": "audio", "payload": "<base64 audio>" }   // synthesized agent speech
 *            { "type": "mark",  "name": "agent-done" }          // end-of-utterance marker
 *
 * Inbound audio → STT → `onTranscript(target Utterance)`.
 * `sendSpeech()` → TTS → chunked outbound `audio` frames + a `mark`.
 */
export interface WsAudioBridgeDeps {
  stt: SpeechToText;
  tts: TextToSpeech;
  /** Default audio encoding when the client's `start` frame omits it. */
  encoding?: "pcm16" | "mulaw";
  /** Default sample rate when the `start` frame omits it. */
  sampleRate?: number;
  /** Outbound chunk size in bytes (defaults to 20ms at the negotiated rate). */
  chunkBytes?: number;
  /** Pacing between outbound chunks in ms (real time by default). */
  frameMs?: number;
}

interface WsInbound {
  type: "start" | "audio" | "stop";
  id?: string;
  sampleRate?: number;
  encoding?: "pcm16" | "mulaw";
  payload?: string;
}

export class WsAudioBridge implements MediaBridge {
  private started = false;
  private closed = false;
  private sttStream: STTStream | null = null;
  private encoding: "pcm16" | "mulaw";
  private sampleRate: number;
  private idValue: string | null = null;
  private readyHandlers: Array<() => void> = [];
  private transcriptHandlers: Array<(u: Utterance) => void> = [];
  private lastAgentSpeechEndedAt = Date.now();
  private partial = "";

  constructor(
    private readonly socket: RawSocket,
    private readonly deps: WsAudioBridgeDeps,
  ) {
    this.encoding = deps.encoding ?? "pcm16";
    this.sampleRate = deps.sampleRate ?? 16000;
    this.socket.on("message", (data) => void this.onMessage(data));
    this.socket.on("close", () => void this.close());
  }

  /** The correlation id supplied on the `start` frame (room / externalId), if any. */
  get id(): string | null {
    return this.idValue;
  }

  onReady(handler: () => void): void {
    this.readyHandlers.push(handler);
  }

  onTranscript(handler: (utterance: Utterance) => void): void {
    this.transcriptHandlers.push(handler);
  }

  private async onMessage(raw: unknown): Promise<void> {
    let msg: WsInbound;
    try {
      msg = JSON.parse(String(raw)) as WsInbound;
    } catch {
      return;
    }

    switch (msg.type) {
      case "start": {
        if (this.started) break;
        this.started = true;
        this.idValue = msg.id ?? null;
        if (msg.encoding) this.encoding = msg.encoding;
        if (msg.sampleRate) this.sampleRate = msg.sampleRate;
        this.sttStream = await this.deps.stt.open({
          sampleRate: this.sampleRate,
          encoding: this.encoding,
        });
        this.sttStream.onChunk((chunk) => {
          if (!chunk.final) {
            this.partial = chunk.text;
            return;
          }
          const text = ((this.partial ? `${this.partial} ` : "") + chunk.text).trim();
          this.partial = "";
          const startedAt = Date.now();
          this.emitTranscript({
            role: "target",
            text,
            startedAt,
            endedAt: startedAt,
            latencyMs: startedAt - this.lastAgentSpeechEndedAt,
            meta: { confidence: chunk.confidence, source: this.deps.stt.name },
          });
        });
        for (const h of this.readyHandlers) h();
        break;
      }
      case "audio": {
        if (msg.payload && this.sttStream) {
          this.sttStream.write(Buffer.from(msg.payload, "base64"));
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
    if (this.closed || !this.started) return;
    const audio = await this.deps.tts.synthesize(text, {
      encoding: this.encoding,
      sampleRate: this.sampleRate,
    });

    // Default to 20ms of audio per chunk (2 bytes/sample for PCM16, 1 for μ-law).
    const bytesPerSample = this.encoding === "mulaw" ? 1 : 2;
    const chunkBytes =
      this.deps.chunkBytes ?? Math.max(1, Math.round((this.sampleRate * 20) / 1000)) * bytesPerSample;
    const frameMs = this.deps.frameMs ?? 20;

    for (let offset = 0; offset < audio.length; offset += chunkBytes) {
      if (this.closed) break;
      const frame = audio.subarray(offset, offset + chunkBytes);
      this.socket.send(
        JSON.stringify({ type: "audio", payload: Buffer.from(frame).toString("base64") }),
      );
      if (frameMs > 0) await sleep(frameMs);
    }
    this.socket.send(JSON.stringify({ type: "mark", name: "agent-done" }));
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
