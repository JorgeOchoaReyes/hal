import { Target, TransportKind, Utterance } from "../types.js";

/**
 * A live, connected call. HAL drives it in text turns: it `speak`s the testing
 * agent's line and `listen`s for the target's transcribed reply. Whether real
 * audio (STT/TTS + media streaming) sits underneath is the transport's concern;
 * the conductor and judge only ever see text.
 */
export interface CallSession {
  /** Provider call id (Twilio Call SID, WebRTC room id, …), if any. */
  readonly externalId?: string;

  /** True when the peer has ended the session. A final reply may still be queued. */
  readonly completed?: boolean;

  /** Speak the agent's line. Resolves once it has been delivered to the target. */
  speak(text: string): Promise<void>;

  /**
   * Wait for the next target utterance. Resolves `null` if the call ended or the
   * timeout elapsed with no speech.
   */
  listen(opts?: { timeoutMs?: number }): Promise<Utterance | null>;

  /** End the call. */
  hangup(reason?: string): Promise<void>;
}

export interface CallTransport {
  readonly kind: TransportKind;
  /** Establish the call to the given target. */
  connect(target: Target): Promise<CallSession>;
}

/**
 * A MediaBridge abstracts the real-time audio plane for telephony / WebRTC /
 * SIP transports. The core library ships the control logic; a host (the web
 * app's media server) provides the concrete bridge that wires provider media
 * streams to STT/TTS. This keeps `@hal/core` free of a bundled media server
 * while still modelling real audio calls precisely.
 */
export interface MediaBridge {
  /** Called once the call is answered and media is flowing. */
  onReady(handler: () => void): void;
  /** Push synthesized agent speech (text -> TTS -> outbound audio). */
  sendSpeech(text: string): Promise<void>;
  /** Register a handler for finalized inbound (target) transcriptions. */
  onTranscript(handler: (utterance: Utterance) => void): void;
  /** Tear down the media plane. */
  close(): Promise<void>;
}

export class TransportError extends Error {
  constructor(
    message: string,
    readonly kind: TransportKind,
  ) {
    super(message);
    this.name = "TransportError";
  }
}
