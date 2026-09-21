/**
 * G.711 μ-law (PCMU) codec.
 *
 * Twilio Media Streams deliver and accept 8 kHz μ-law audio in 20 ms frames
 * (160 bytes), base64-encoded. Deepgram (and most STT/TTS) speak linear PCM16,
 * so the bridge converts between the two with these functions. They are pure and
 * fully unit-tested — the reliable floor the live media plane is built on.
 */

const BIAS = 0x84; // 132
const CLIP = 32635;

/** Encode one 16-bit linear PCM sample to a μ-law byte. */
export function muLawEncodeSample(sample: number): number {
  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;

  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent--;
  }

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  const muLaw = ~(sign | (exponent << 4) | mantissa);
  return muLaw & 0xff;
}

/** Decode one μ-law byte to a 16-bit linear PCM sample. */
export function muLawDecodeSample(muLaw: number): number {
  muLaw = ~muLaw & 0xff;
  const sign = muLaw & 0x80;
  const exponent = (muLaw >> 4) & 0x07;
  const mantissa = muLaw & 0x0f;
  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  return sign !== 0 ? -sample : sample;
}

/** Decode a μ-law buffer to little-endian PCM16. */
export function decodeMuLaw(mulaw: Uint8Array): Int16Array {
  const out = new Int16Array(mulaw.length);
  for (let i = 0; i < mulaw.length; i++) {
    out[i] = muLawDecodeSample(mulaw[i]!);
  }
  return out;
}

/** Encode PCM16 samples to a μ-law buffer. */
export function encodeMuLaw(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    out[i] = muLawEncodeSample(pcm[i]!);
  }
  return out;
}

/** Convert a little-endian PCM16 byte buffer to Int16 samples. */
export function bytesToPcm16(bytes: Uint8Array): Int16Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Int16Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = view.getInt16(i * 2, true);
  }
  return out;
}

/** Convert Int16 samples to a little-endian PCM16 byte buffer. */
export function pcm16ToBytes(pcm: Int16Array): Uint8Array {
  const bytes = new Uint8Array(pcm.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < pcm.length; i++) {
    view.setInt16(i * 2, pcm[i]!, true);
  }
  return bytes;
}
