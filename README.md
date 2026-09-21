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
  ElevenLabs, Bland); HAL provisions a testing agent there, stores it, and uses
  it to place calls — then judges the transcript. No media server needed. A
  Structured Test compiles into each platform's **native agent config**
  (a step-by-step reproduction) — previewable before you provision.
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

## Quick start

```bash
pnpm install
pnpm build

# Web app (http://localhost:3000) — works immediately in mock mode
pnpm web

# Desktop app (needs the Electron binary; see below)
pnpm desktop
```

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
| `DEEPGRAM_API_KEY` | Speech-to-text for real audio calls. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | Real PSTN calls. |
| `HAL_PUBLIC_URL` | Publicly reachable base URL for Twilio / WebRTC callbacks. |
| `HAL_MEDIA_PORT` | Port the web app starts its media server on when Twilio is configured (default 8787). |
| `HAL_DATA_DIR` | Where simulations and run results are persisted (default `./data`). |

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

See `packages/core/src/transport/transport.ts` and
`packages/core/src/speech/speech.ts` for the underlying contracts.

## Testing against a real voice agent

Two paths, easiest first.

### A. Hosted testing agent (Vapi / ElevenLabs) — no media server needed

HAL creates a testing agent **on your voice platform** using your credentials and
tells that platform to call your target number. The platform handles all audio, so
you need no Deepgram key, no public URL, and no media server.

```bash
pnpm install && pnpm build
OPENAI_API_KEY=sk-...   # (or ANTHROPIC_API_KEY) for the judge & metrics
pnpm web                # http://localhost:3000
```

1. Open **Hosted agents** (top nav).
2. **Connect a provider account** — pick Vapi (or ElevenLabs), paste your API key
   and phone-number id.
3. **Provision a testing agent** — name it and write the tester's system prompt
   (what it should try to do on the call).
4. In the agent's row, enter your **target number** and hit **Place test call**.
   HAL places the call via the platform, waits for it to finish, pulls the
   transcript, and judges it — you'll see the status + metric labels inline.

### B. HAL-driven telephony (Twilio + Deepgram)

HAL itself drives the audio. Needs `TWILIO_*`, `DEEPGRAM_API_KEY`, and a public URL.

```bash
export TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM_NUMBER=+1...
export DEEPGRAM_API_KEY=... HAL_PUBLIC_URL=https://<your-tunnel>
pnpm web
```

Create a simulation with the **Twilio** provider template, enter your target
number, and run it. (The media server starts automatically when Twilio env is set.)

> Only place automated calls to a number you own or are authorized to test.

## Self-hosting

The web app builds to a standalone Next.js server:

```bash
pnpm --filter @hal/web build
node apps/web/.next/standalone/apps/web/server.js   # or: docker build -t hal .
```

A `Dockerfile` is included for containerized deployment.

## Development

```bash
pnpm dev         # everything in watch mode
pnpm typecheck   # type-check all packages
pnpm test        # run tests
```

## License

MIT
