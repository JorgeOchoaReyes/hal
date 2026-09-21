#!/usr/bin/env node
import { MediaServer } from "./server/media-server.js";

/**
 * Standalone HAL media server. Run it alongside the web app to give telephony
 * test calls a real audio plane:
 *
 *   HAL_PUBLIC_URL=https://media.example.com DEEPGRAM_API_KEY=... hal-media
 *
 * Expose it publicly (or via a tunnel) so Twilio can reach the μ-law stream and
 * TwiML endpoints. Point your telephony transport's bridge factory at
 * `server.bridgeFactory` when embedding, or use the TwiML from `/api/media/twiml`.
 */
async function main() {
  const port = Number(process.env.HAL_MEDIA_PORT ?? 8787);
  const server = new MediaServer();
  await server.listen(port);

  const publicUrl = process.env.HAL_PUBLIC_URL ?? `http://localhost:${port}`;
  // eslint-disable-next-line no-console
  console.log(
    `[hal-media] listening on :${port}\n` +
      `  TwiML:  ${publicUrl.replace(/\/$/, "")}/api/media/twiml\n` +
      `  Stream: ${publicUrl.replace(/^http/, "ws").replace(/\/$/, "")}/api/media/twilio\n` +
      (process.env.DEEPGRAM_API_KEY
        ? "  Deepgram: configured"
        : "  Deepgram: NOT configured (set DEEPGRAM_API_KEY for STT/TTS)"),
  );

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[hal-media] failed to start:", err);
  process.exit(1);
});
