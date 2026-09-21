import { test } from "node:test";
import assert from "node:assert/strict";
import { BridgeRegistry } from "../server/registry.js";
import type { MediaBridge } from "@hal/core";

function fakeBridge(): MediaBridge {
  return {
    onReady() {},
    onTranscript() {},
    async sendSpeech() {},
    async close() {},
  };
}

test("claim resolves when fulfill arrives afterwards", async () => {
  const reg = new BridgeRegistry();
  const bridge = fakeBridge();
  const p = reg.claim("CA1", 1000);
  reg.fulfill("CA1", bridge);
  assert.equal(await p, bridge);
});

test("fulfill before claim is parked and returned to the next claim", async () => {
  const reg = new BridgeRegistry();
  const bridge = fakeBridge();
  reg.fulfill("CA2", bridge);
  assert.equal(await reg.claim("CA2", 1000), bridge);
});

test("claim rejects after timeout when no stream arrives", async () => {
  const reg = new BridgeRegistry();
  await assert.rejects(() => reg.claim("CA3", 20), /No media stream/);
});
