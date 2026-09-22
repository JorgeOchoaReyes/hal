import { test } from "node:test";
import assert from "node:assert/strict";
import { WsAudioBridge } from "../bridge/ws-audio-bridge.js";
import { RawSocket } from "../bridge/twilio-bridge.js";
import type { SpeechToText, STTStream, TextToSpeech, TranscriptChunk, Utterance } from "@hal/core";

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
  opened?: { sampleRate: number; encoding: string };
  async open(opts: { sampleRate: number; encoding: string }) {
    this.opened = opts;
    return this.stream;
  }
}

class FakeTTS implements TextToSpeech {
  readonly name = "fake";
  async synthesize() {
    // 1280 bytes = 2 chunks of 640 bytes (20ms @ 16kHz PCM16).
    return new Uint8Array(1280).fill(0x01);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 5));

test("ws bridge: start negotiates encoding, transcribes, and chunks outbound speech", async () => {
  const socket = new FakeSocket();
  const stt = new FakeSTT();
  const bridge = new WsAudioBridge(socket, { stt, tts: new FakeTTS(), frameMs: 0 });

  let ready = false;
  bridge.onReady(() => (ready = true));
  const transcripts: Utterance[] = [];
  bridge.onTranscript((u) => transcripts.push(u));

  socket.emit({ type: "start", id: "room-42", sampleRate: 16000, encoding: "pcm16" });
  await tick();
  assert.equal(ready, true, "onReady fired on start");
  assert.equal(bridge.id, "room-42");
  assert.deepEqual(stt.opened, { sampleRate: 16000, encoding: "pcm16" });

  // Inbound audio reaches STT.
  socket.emit({ type: "audio", payload: Buffer.from([1, 2, 3, 4]).toString("base64") });
  await tick();
  assert.ok(stt.stream.written > 0, "inbound audio forwarded to STT");

  // A final chunk becomes a target utterance.
  stt.stream.handler?.({ text: "hi from target", final: true, startedAt: Date.now() });
  assert.equal(transcripts.length, 1);
  assert.equal(transcripts[0]!.role, "target");
  assert.equal(transcripts[0]!.text, "hi from target");

  // Outbound speech is chunked (1280 bytes / 640 = 2 audio frames) + 1 mark.
  await bridge.sendSpeech("hello");
  const audio = socket.sent.filter((s) => s.includes('"type":"audio"'));
  const marks = socket.sent.filter((s) => s.includes('"type":"mark"'));
  assert.equal(audio.length, 2, "1280 bytes -> two 640-byte chunks");
  assert.equal(marks.length, 1, "a completion mark is sent");
});

test("ws bridge: partial chunks are prepended to the final transcript", async () => {
  const socket = new FakeSocket();
  const stt = new FakeSTT();
  const bridge = new WsAudioBridge(socket, { stt, tts: new FakeTTS() });
  const out: Utterance[] = [];
  bridge.onTranscript((u) => out.push(u));

  socket.emit({ type: "start" });
  await tick();
  stt.stream.handler?.({ text: "book a", final: false, startedAt: Date.now() });
  stt.stream.handler?.({ text: "table", final: true, startedAt: Date.now() });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.text, "book a table");
});

test("ws bridge: stop closes the stream and socket", async () => {
  const socket = new FakeSocket();
  const stt = new FakeSTT();
  let closed = false;
  const origClose = stt.stream.close.bind(stt.stream);
  stt.stream.close = async () => {
    closed = true;
    return origClose();
  };
  const bridge = new WsAudioBridge(socket, { stt, tts: new FakeTTS() });
  socket.emit({ type: "start" });
  await tick();
  socket.emit({ type: "stop" });
  await tick();
  assert.equal(closed, true, "STT stream closed on stop");
  // Speaking after close is a no-op.
  await bridge.sendSpeech("nope");
  assert.equal(socket.sent.length, 0);
});
