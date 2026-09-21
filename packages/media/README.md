# @hal/media

The **media plane** for HAL: a Twilio Media Streams ⇄ Deepgram bridge that gives
the core engine real audio phone calls. With it wired in, a `telephony` test case
runs through the exact same conductor + judge pipeline as a `mock` one — HAL just
speaks and listens over a live PSTN call instead of in-process.

```
inbound   Twilio μ-law  ──▶  Deepgram STT  ──▶  target Utterance ─▶ Conductor
outbound  Conductor ─▶ sendSpeech()  ──▶  Deepgram Aura TTS  ──▶  μ-law ─▶ Twilio
```

## What's inside

| Module | Purpose |
|--------|---------|
| `audio/mulaw` | G.711 μ-law ⇄ PCM16 codec (pure, unit-tested) |
| `stt/deepgram` | Streaming speech-to-text (Deepgram realtime WS, token subprotocol auth) |
| `tts/deepgram` | Deepgram Aura TTS, returning raw μ-law/8k ready for Twilio |
| `bridge/twilio-bridge` | `MediaBridge` over one Twilio Media Streams socket |
| `server/media-server` | HTTP + WS server: TwiML endpoint, stream endpoint, `bridgeFactory` |
| `server/registry` | Correlates an outbound Call SID with its inbound media stream |

Deepgram consumes and produces μ-law/8 kHz directly, so no transcoding sits in the
hot path; the codec is a tested fallback for other providers.

## Run the server

```bash
pnpm --filter @hal/media build
HAL_PUBLIC_URL=https://media.example.com DEEPGRAM_API_KEY=... pnpm --filter @hal/media start
```

It must be publicly reachable (or tunneled) so Twilio can open the μ-law stream.
Endpoints:

- `GET /api/media/twiml` — TwiML that connects an answered call to the stream
- `WS  /api/media/twilio` — the Media Streams endpoint
- `GET /health`

## Wire it into the engine

```ts
import { HalEngine } from "@hal/core";
import { MediaServer } from "@hal/media";

const media = new MediaServer({ publicUrl: process.env.HAL_PUBLIC_URL });
await media.listen(8787);

const engine = new HalEngine({
  telephony: {
    config: {}, // TWILIO_* read from env
    bridgeFactory: media.bridgeFactory,
  },
});

// A telephony test case now places a real call and is judged like any other.
const result = await engine.runToCompletion(myTelephonyTestCase);
```

The telephony transport places the call via Twilio REST, Twilio dials the target
and connects its media to `/api/media/twilio`, the registry matches that stream to
the outbound Call SID, and the bridge starts feeding transcripts to the conductor.

## Notes

- Auth for Deepgram STT uses the `['token', <key>]` WebSocket subprotocol, so it
  works with Node's global `WebSocket` (which cannot set request headers).
- Swap `stt` / `tts` in `MediaServer` options for any implementation of core's
  `SpeechToText` / `TextToSpeech` (OpenAI, ElevenLabs, a local whisper.cpp, …).
