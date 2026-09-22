<div align="center">

# 🔴 HAL

**A local / self-hostable service for testing voice AI agents.**

HAL spins up a simulated AI caller, places a test call to *your* voice agent over
any channel (phone, WebRTC, SIP, or a fully in-process mock), drives the
conversation **turn by turn**, and uses an LLM judge to classify each call
**pass** or **fail**.

</div>

---

## Why

If you ship a voice AI — a receptionist, a support line, an outbound bot — you
need to know it still works after every change. HAL is the automated tester:
it calls your agent the way a real person would, follows a scripted or dynamic
scenario, and grades the transcript against criteria you define. Run it locally
while developing, or self-host it as a shared regression suite.

## What it does

- **Framework-agnostic caller.** The testing agent is driven by any LLM
  (OpenAI, Anthropic, an OpenAI-compatible local model, or a deterministic mock).
- **Turn-by-turn simulation.** Scenarios are a list of steps you fully control:
  `say` (scripted line), `prompt` (let a persona improvise toward a goal),
  `wait`, `expect` (live mid-call assertion), and `hangup`. Mix scripted and
  dynamic behaviour freely.
- **Every way to reach the target:**
  | Transport | How it reaches your agent |
  |-----------|---------------------------|
  | `mock` | In-process simulated agent — no calls, no keys. Great for authoring & CI. |
  | `telephony` | Real PSTN call via **Twilio** to any phone number you provide. |
  | `webrtc` | Joins a **WebRTC** room / signaling endpoint your agent is on. |
  | `sip` | Dials a **SIP** URI directly against your own PBX / trunk. |
- **LLM judge (pass/fail).** Combines fast deterministic rules (contains, regex,
  latency, turn counts) with an LLM evaluating natural-language criteria. Modes:
  `all`, `rules-only`, `llm-only`.
- **Provider templates.** One reusable recipe per way of placing a call (mock,
  Twilio telephony, WebRTC, SIP): each declares its config fields and required
  env, so the UI renders a form and builds a runnable target for you.
- **Hosted testing agents.** Bring credentials for a voice platform (Vapi,
  ElevenLabs, Bland, Retell); HAL provisions a testing agent there and uses it to
  place calls — then judges the transcript. No media server needed. A Structured
  Test compiles into each platform's **native node/graph format** — Bland
  **pathway**, Vapi **workflow**, Retell **conversation flow**, ElevenLabs
  **workflow** — a faithful step-by-step reproduction, previewable before you
  provision. **Ad-hoc dispatch**: from a simulation, HAL compiles + creates the
  agent at dispatch time, places the call, and judges it.
- **Create simulations in the UI.** Compose a test from a provider template, a
  caller persona, and either a linear turn-by-turn script **or a Structured Test**
  (a `role` + `conditions` decision tree, with `FIRST_MESSAGE` and
  `action_followup` sequencing) that adapts to what the agent says.
- **Typed metrics.** User-defined metrics with output types **boolean** (affects
  pass/fail), **rating** (0–100%), **numeric**, and **enum** — scored by the LLM
  judge — plus objective per-call metrics & labels (latency p50/p95/max, turns,
  verbosity, pass rates), surfaced live and in each simulation's run history.
- **Live streaming UI.** Watch the transcript, live assertions, verdict, and
  metrics appear in real time as the call runs.
- **Two ways to run it:** a self-hostable **web app** (Next.js) and a
  **desktop app** (Electron) that bundles it for offline local use.

## Monorepo layout

```
hal/
├── apps/
│   ├── web/        @hal/web      Next.js self-hostable app (dashboard + API + SSE runner)
│   └── desktop/    @hal/desktop  Electron shell around the web app
└── packages/
    ├── core/       @hal/core     The engine: agents, simulation, transports, judge, runner
    └── media/      @hal/media    Twilio Media Streams ⇄ Deepgram bridge for real audio calls
```

`@hal/core` has **zero runtime dependencies** — every provider (LLM, telephony,
speech) is reached over `fetch` or a pluggable interface, so the engine builds
and runs anywhere.

## Prerequisites

- **Node.js ≥ 20** (≥ **22.5** recommended — the SQLite backend uses the built-in
  `node:sqlite`; on older Node it transparently falls back to JSON files).
- **pnpm 10** (`corepack enable` picks up the pinned `packageManager` version).
- No API keys needed to start — everything runs in mock mode offline.

## Quick start

```bash
pnpm install
pnpm build

# Web app (http://localhost:3000) — works immediately in mock mode
pnpm web

# Run the full test/typecheck/build suite
pnpm test

# Desktop app (Electron shell around the web app; see Self-hosting → Desktop app)
pnpm desktop
```

That's the whole "what's needed to run": **install → build → `pnpm web`**, then
open <http://localhost:3000>. Real models, calls, and persistence activate as
soon as you add the matching keys in `.env` (see [Configuration](#configuration)) —
nothing else is required.

Open the dashboard, pick a sample suite (e.g. *Booking — happy path*), and hit
**Run test call**. With no API keys, HAL uses a deterministic mock LLM and mock
target so the whole pipeline works offline. Add keys in `.env` (copy
`.env.example`) to use real models and place real calls.

### Run the engine directly

```ts
import { HalEngine, bookingHappyPath } from "@hal/core";

const engine = new HalEngine();               // auto-detects OPENAI/ANTHROPIC keys
const result = await engine.runToCompletion(bookingHappyPath());
console.log(result.status, result.verdict?.summary);
```

### Author a scenario

```ts
import { scenario, type Persona } from "@hal/core";

const persona: Persona = {
  name: "New patient",
  systemPrompt: "You are booking your first dental appointment. Be brief.",
};

const scn = scenario("Booking", persona)
  .say("Hi, I'd like to book an appointment.")
  .expect({ id: "asks-day", description: "asks which day", matches: "day|when" })
  .prompt("Pick the first day offered and confirm.")
  .say("No, that's all. Thanks!")
  .hangup()
  .build();
```

## Configuration

Copy `.env.example` to `.env`:

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | LLM for the persona **and** the judge. |
| `DEEPGRAM_API_KEY` | Speech-to-text/TTS for real audio calls. Also auto-starts the WebRTC/SIP media gateway. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | Real PSTN calls. |
| `HAL_PUBLIC_URL` | Publicly reachable base URL for Twilio / WebRTC callbacks. |
| `HAL_MEDIA_PORT` | Port for the Twilio media server (default 8787; auto-starts with the `TWILIO_*` vars). |
| `HAL_MEDIA_GATEWAY` | Set to `off` to disable the WebRTC/SIP gateway (default on when `DEEPGRAM_API_KEY` is set). |
| `HAL_GATEWAY_PORT` | Port for the WebRTC/SIP media gateway (default 8788). |
| `HAL_DATA_DIR` | Where simulations and run results are persisted (default `./data`). |
| `HAL_DB` | Persistence backend: `sqlite` (default, needs Node ≥ 22.5) or `json`. |
| `HAL_WEB_URL` | URL the desktop shell loads in dev (default `http://localhost:3000`). |

Hosted providers (Vapi / ElevenLabs / Bland / Retell) don't use env vars — you add
each account's API key in the app's **Hosted agents** panel, and it's stored in the
local DB. Use the **Test connection** button there to verify a key before running.

No keys? Everything still runs in **mock mode**.

## Real audio calls & the media plane

`@hal/core` owns call *control* (placing / ending calls, driving turns, judging).
The real-time *audio* plane — bridging provider media streams to STT/TTS — is
supplied through the `MediaBridge` interface, so the engine stays free of a bundled
media server and you can plug in Deepgram, ElevenLabs, a local whisper.cpp, LiveKit,
etc. Mock and text modes need no media bridge and work out of the box.

For **real PSTN calls**, `@hal/media` ships a concrete
[Twilio Media Streams ⇄ Deepgram bridge](packages/media/README.md):

```bash
HAL_PUBLIC_URL=https://media.example.com DEEPGRAM_API_KEY=... pnpm --filter @hal/media start
```

```ts
import { HalEngine } from "@hal/core";
import { MediaServer } from "@hal/media";

const media = new MediaServer({ publicUrl: process.env.HAL_PUBLIC_URL });
await media.listen(8787);

const engine = new HalEngine({
  telephony: { config: {}, bridgeFactory: media.bridgeFactory }, // TWILIO_* from env
});
// A `telephony` test case now places a real call and is judged like any other.
```

For **WebRTC and SIP calls**, `@hal/media` ships a vendor-neutral
[`MediaGateway`](packages/media/src/server/media-gateway.ts): one WebSocket audio
plane both transports share. HAL doesn't terminate ICE/DTLS/SRTP or SIP signaling
itself — the same way telephony leans on Twilio for call control — it accepts PCM
over a WebSocket from a thin media source:

- **WebRTC**: a browser (or a WHIP / LiveKit egress) captures mic audio and relays
  PCM16 frames to `/api/media/webrtc?id=<room>`. See
  [`packages/media/webrtc-client.example.html`](packages/media/webrtc-client.example.html)
  for a ~40-line reference client.
- **SIP**: a SIP↔WS shim (FreeSWITCH `mod_audio_fork`, drachtio + rtpengine, or
  Jambonz) forks an established leg's RTP onto `/api/media/sip?id=<externalId>`.

```ts
import { HalEngine } from "@hal/core";
import { MediaGateway } from "@hal/media";

const gateway = new MediaGateway(); // DEEPGRAM_API_KEY from env
await gateway.listen(8788);

const engine = new HalEngine({
  webrtc: { bridgeFactory: gateway.webrtcBridgeFactory },
  sip: { bridgeFactory: gateway.sipBridgeFactory },
});
// `webrtc` / `sip` test cases now run through the same conductor + judge.
```

The web app starts this gateway automatically when `DEEPGRAM_API_KEY` is set
(disable with `HAL_MEDIA_GATEWAY=off`). The protocol is documented in
[`ws-audio-bridge.ts`](packages/media/src/bridge/ws-audio-bridge.ts).

See `packages/core/src/transport/transport.ts` and
`packages/core/src/speech/speech.ts` for the underlying contracts.

## Testing HAL

There are four levels, from "no setup" to "real phone call". Do them in order.

> ⚠️ Only place automated calls to a number you own or are authorized to test.
> The hosted-provider adapters are modeled from public API docs; your first live
> call is the real check — if a payload is off, the fix is localized to that
> provider's adapter in `packages/core/src/providers/hosted/`.

### 1. Run the automated tests (no setup)

```bash
pnpm install
pnpm build
pnpm test        # unit tests across @hal/core and @hal/media
pnpm typecheck   # type-check everything
```

### 2. Try the app in mock mode (no keys)

```bash
pnpm web         # http://localhost:3000
```

Open the dashboard, pick a sample suite (*Booking — happy path*), and hit
**Run test call**. HAL uses a deterministic mock caller + mock target and streams
the transcript, live assertions, judge verdict, and metrics — the whole pipeline,
offline. The mock LLM is intentionally simple; add an LLM key (next step) to make
the caller and judge behave realistically.

### 3. Build & judge your own simulation (LLM key)

```bash
export OPENAI_API_KEY=sk-...     # or ANTHROPIC_API_KEY — powers the caller & judge
pnpm web
```

**+ New simulation** →
1. Pick a **provider template** (use `mock` to iterate with no calls).
2. Write the caller **persona**.
3. Choose the conversation model:
   - **Linear steps** — `say` / `prompt` / `wait` / `expect` / `branch` / `hangup`, or
   - **Structured test** — a `role` + `conditions` decision tree (`FIRST_MESSAGE`,
     standard triggers, `action_followup`) with control tags (`<endcall/>`,
     `<dtmf/>`, `<silence/>`, …).
4. Add **metrics** — boolean / rating (0–100%) / numeric / enum — and rules/criteria.

Run it and you'll see the transcript, verdict, typed metric results, and labels
live; each simulation keeps a run history. Simulations and results persist to
`HAL_DATA_DIR` (default `./data`).

### 4. Call a real voice agent

Two ways, easiest first.

**A. Hosted testing agent (Vapi / ElevenLabs / Bland / Retell) — no media server.**
HAL provisions a testing agent **on your platform** with your credentials and has
that platform call your target number; the platform handles all audio (no Deepgram,
no public URL, no media server).

```bash
export OPENAI_API_KEY=sk-...     # for the judge & metrics
pnpm web
```

1. **Hosted agents** (top nav) → **Connect a provider account** (Vapi / ElevenLabs /
   Bland / Retell) → paste your API key + phone-number id.
2. **Provision a testing agent** — either a plain system prompt, or tick
   **"Reproduce a structured test"** and paste a structured test. Hit
   **Preview `<platform>` config** to see the exact **native node graph** HAL will
   create (Bland pathway / Vapi workflow / Retell conversation flow / ElevenLabs
   workflow).
3. Enter your **target number** and **Place test call** — HAL places the call, waits,
   pulls the transcript, and judges it (status + metric labels inline).

Or **dispatch a saved structured simulation**: open the simulation → **Dispatch to a
hosted provider** → pick an account + number. HAL compiles it into that platform's
native node format, ad-hoc creates the agent, calls, and judges — all in one click.

**B. HAL-driven telephony (Twilio + Deepgram).** HAL itself drives the audio.

```bash
export TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM_NUMBER=+1...
export DEEPGRAM_API_KEY=... HAL_PUBLIC_URL=https://<your-public-url-or-tunnel>
pnpm web
```

Create a simulation with the **Twilio** provider template, enter your target number,
and run it. The media server starts automatically when the Twilio env vars are set.

## Self-hosting

The web app builds to a standalone Next.js server:

```bash
pnpm --filter @hal/web build
node apps/web/.next/standalone/apps/web/server.js   # or: docker build -t hal .
```

A `Dockerfile` is included for containerized deployment.

### Desktop app

The Electron shell wraps the same web app for a local, self-contained lab. In
dev it points at a running web server; in a packaged build it boots the bundled
Next.js standalone server offline.

```bash
pnpm web                                   # start the web app on :3000
pnpm desktop                               # launch the Electron shell (loads HAL_WEB_URL)
pnpm --filter @hal/desktop package         # build a distributable (electron-builder)
```

The Electron binary is fetched by `pnpm install`; if your install skipped build
scripts, run `pnpm --filter @hal/desktop exec electron --version` once to trigger
it. To prove it launches headlessly (CI / servers), `pnpm --filter @hal/desktop
smoke` renders the app under `xvfb` and writes a screenshot.

## Development

```bash
pnpm dev         # everything in watch mode
pnpm typecheck   # type-check all packages
pnpm test        # run tests
```

## License

MIT
