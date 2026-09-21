/**
 * Speech interfaces. Real-audio transports (telephony / webrtc / sip) turn the
 * target's audio into text with a `SpeechToText` and the agent's text into audio
 * with a `TextToSpeech`. Text/mock mode skips both. Concrete implementations
 * (Deepgram, OpenAI, ElevenLabs, a local whisper.cpp) live in the host media
 * server; core only defines the contracts so bridges stay swappable.
 */

export interface TranscriptChunk {
  text: string;
  /** Whether this is a finalized utterance vs an interim hypothesis. */
  final: boolean;
  confidence?: number;
  startedAt: number;
  endedAt?: number;
}

export interface SpeechToText {
  readonly name: string;
  /**
   * Open a streaming session. Push raw audio frames with `write`; receive
   * transcript chunks via `onChunk`. `close` flushes and ends the stream.
   */
  open(opts: { sampleRate: number; encoding: string }): Promise<STTStream>;
}

export interface STTStream {
  write(frame: Uint8Array): void;
  onChunk(handler: (chunk: TranscriptChunk) => void): void;
  close(): Promise<void>;
}

export interface TextToSpeech {
  readonly name: string;
  /** Synthesize text to an audio buffer in the requested encoding. */
  synthesize(text: string, opts?: { voice?: string; encoding?: string; sampleRate?: number }): Promise<Uint8Array>;
}
