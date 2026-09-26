import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { persistRecording, recordingPath, audioRange } from "../recordingFiles";

test("downloads atomically, rejects non-audio and oversized streams, and isolates run paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hal-recording-test-"));
  const previous = process.env.HAL_DATA_DIR;
  process.env.HAL_DATA_DIR = dir;
  try {
    const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
    const metadata = await persistRecording("run1", new Response(bytes, { headers: { "content-type": "audio/wav" } }));
    assert.equal(metadata.bytes, bytes.length);
    assert.deepEqual(await readFile(recordingPath("run1")), Buffer.from(bytes));
    assert.equal(dirname(recordingPath("../../secrets.key")), join(dir, "recordings"));
    await assert.rejects(persistRecording("run1", new Response('{"errors":[]}', { headers: { "content-type": "application/json" } })), /not returned an audio recording/);
    assert.deepEqual(await readFile(recordingPath("run1")), Buffer.from(bytes), "failed replacement preserves original audio");
    await assert.rejects(persistRecording("too-big", new Response(bytes, { headers: { "content-type": "audio/wav" } }), 3), /limit/);
    await assert.rejects(persistRecording("empty", new Response(new Uint8Array(), { headers: { "content-type": "audio/wav" } })), /empty/);
    assert.equal((await readdir(join(dir, "recordings"))).length, 1, "partial downloads are cleaned up");
  } finally {
    if (previous === undefined) delete process.env.HAL_DATA_DIR; else process.env.HAL_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("audio ranges support seeking and reject invalid ranges", () => {
  assert.deepEqual(audioRange(null, 100), { start: 0, end: 99 });
  assert.deepEqual(audioRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(audioRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(audioRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(audioRange("bytes=90-999", 100), { start: 90, end: 99 });
  for (const range of ["bytes=100-", "bytes=20-10", "bytes=-0", "bytes=0-1,4-5", "bytes=-", "garbage"]) assert.equal(audioRange(range, 100), null);
});
