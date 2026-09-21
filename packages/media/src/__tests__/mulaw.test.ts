import { test } from "node:test";
import assert from "node:assert/strict";
import {
  muLawEncodeSample,
  muLawDecodeSample,
  encodeMuLaw,
  decodeMuLaw,
  bytesToPcm16,
  pcm16ToBytes,
} from "../audio/mulaw.js";

test("μ-law encodes silence and decodes it back to near-zero", () => {
  const encoded = muLawEncodeSample(0);
  assert.equal(encoded, 0xff, "0 encodes to 0xFF in μ-law");
  const decoded = muLawDecodeSample(encoded);
  assert.ok(Math.abs(decoded) <= 8, `silence should decode near zero, got ${decoded}`);
});

test("μ-law round-trip stays within quantization error and preserves sign/monotonicity", () => {
  const samples = [-32000, -16000, -4000, -100, 0, 100, 4000, 16000, 32000];
  let last = -Infinity;
  for (const s of samples) {
    const round = muLawDecodeSample(muLawEncodeSample(s));
    // μ-law error grows with amplitude; ~1% of full scale is a safe bound.
    assert.ok(Math.abs(round - s) <= 400, `sample ${s} -> ${round} exceeded error bound`);
    if (s > 0) assert.ok(round > 0, "positive stays positive");
    if (s < 0) assert.ok(round < 0, "negative stays negative");
    assert.ok(round >= last - 1, "decode is monotonic in the sample");
    last = round;
  }
});

test("buffer-level μ-law and PCM16 helpers preserve length and are reversible", () => {
  const pcm = Int16Array.from([0, 1000, -1000, 20000, -20000]);
  const mulaw = encodeMuLaw(pcm);
  assert.equal(mulaw.length, pcm.length);
  const back = decodeMuLaw(mulaw);
  assert.equal(back.length, pcm.length);

  const bytes = pcm16ToBytes(pcm);
  assert.equal(bytes.length, pcm.length * 2);
  const restored = bytesToPcm16(bytes);
  assert.deepEqual(Array.from(restored), Array.from(pcm), "PCM16<->bytes is lossless");
});
