import { test } from "node:test";
import assert from "node:assert/strict";
import { TwilioMediaBridge, RawSocket } from "../bridge/twilio-bridge.js";
import type { SpeechToText, STTStream, TextToSpeech, TranscriptChunk, Utterance } from "@hal/core";

/** A socket we can drive from the test and whose sends we can inspect. */
class FakeSocket implements RawSocket {
  sent: string[] = [];
  private msgCb?: (data: unknown) => void;
  private closeCb?: () => void;
  send(data: string) {
    this.sent.push(data);
  }
  on(event: "message" | "close", cb: (data?: unknown) => void) {
    if (event === "message") this.msgCb = cb as (d: unknown) => void;
    else this.closeCb = cb as () => void;
  }
  close() {
    this.closeCb?.();
  }
  emit(obj: unknown) {
    this.msgCb?.(JSON.stringify(obj));
  }
}

class FakeSTTStream implements STTStream {
  handler?: (chunk: TranscriptChunk) => void;
  written = 0;
  write() {
    this.written++;
  }
  onChunk(handler: (chunk: TranscriptChunk) => void) {
    this.handler = handler;
  }
  async close() {}
}

class FakeSTT implements SpeechToText {
  readonly name = "fake";
  stream = new FakeSTTStream();
  async open() {
    return this.stream;
  }
}

class FakeTTS implements TextToSpeech {
  readonly name = "fake";
  async synthesize() {
    // 320 bytes -> exactly two 160-byte μ-law frames.
    return new Uint8Array(320).fill(0xff);
  }
}

test("bridge starts, transcribes inbound audio, and frames outbound speech", async () => {
  const socket = new FakeSocket();
  const stt = new FakeSTT();
  const tts = new FakeTTS();
  const bridge = new TwilioMediaBridge(socket, { stt, tts, frameMs: 0 });

  let ready = false;
  bridge.onReady(() => (ready = true));
  const transcripts: Utterance[] = [];
  bridge.onTranscript((u) => transcripts.push(u));

  // Twilio starts the stream.
  socket.emit({ event: "start", start: { streamSid: "MZ1", callSid: "CA9" } });
  await tick();
  assert.equal(ready, true, "onReady fired on start");
  assert.equal(bridge.callSid, "CA9");

  // Inbound media reaches the STT stream.
  socket.emit({ event: "media", media: { payload: Buffer.from([0xff, 0xff]).toString("base64") } });
  await tick();
  assert.ok(stt.stream.written > 0, "inbound audio forwarded to STT");

  // A final STT chunk becomes a target utterance.
  stt.stream.handler?.({ text: "hello there", final: true, startedAt: Date.now() });
  assert.equal(transcripts.length, 1);
  assert.equal(transcripts[0]!.role, "target");
  assert.equal(transcripts[0]!.text, "hello there");

  // Outbound speech is TTS'd and framed to Twilio (2 media frames + 1 mark).
  await bridge.sendSpeech("hi");
  const media = socket.sent.filter((s) => s.includes('"event":"media"'));
  const marks = socket.sent.filter((s) => s.includes('"event":"mark"'));
  assert.equal(media.length, 2, "320 bytes -> two 160-byte frames");
  assert.equal(marks.length, 1, "a completion mark is sent");
  assert.ok(media[0]!.includes('"streamSid":"MZ1"'), "frames carry the streamSid");
});

function tick() {
  return new Promise((r) => setTimeout(r, 5));
}
