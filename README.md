# HAL — Voice AI Test Lab

HAL is a local/self-hosted application for creating voice-agent simulations,
placing test calls, and evaluating transcripts with rules and LLM judges. It
includes a Next.js web app, an Electron desktop shell, a shared testing engine,
and a media bridge for real audio.

## Run locally

Use Node.js 22.5+ (for SQLite) and the pnpm version in `package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm web
```

Open http://localhost:3000. Mock tests need no provider credentials. Configure
LLM keys under Settings and voice-provider accounts under Hosted agents. To use
environment variables, copy `.env.example` to `apps/web/.env.local` and populate
only the providers you use. Restart after changing media/telephony settings.

```sh
pnpm test
pnpm typecheck
pnpm desktop  # with the web dev server running
```

## Bland caller ID troubleshooting

The **inbound number** is the destination. **Outbound caller ID (`from`)** is the
number placing the call. These are separate fields.

- **Use provider account default** uses the account's configured From number.
- **Use Bland default pool** omits `from`, even if the account has a saved default.
- **Choose a caller ID** uses the number explicitly entered for this dispatch.

A custom caller ID must belong to the selected Bland account and include `+`
and a country code, such as `+14155550123`. HAL removes formatting spaces,
parentheses, periods and hyphens, but does not guess a country code. For a number
uploaded from Twilio, configure the matching Bland BYOT encrypted key on the
provider account or outbound agent, or enter it in dispatch’s **Twilio BYOT
encrypted key** field beside the caller ID. Give the key a name and choose **Save key for reuse**, then select it on future
calls for that Bland account. Saved keys persist across app restarts, encrypted
at rest in the local data directory; only names and IDs are returned to the UI.
Use **Remove saved key** to delete one. A selected key takes precedence over
the outbound agent/account key. Unsaved input applies to this call only.
Keys are never included in run snapshots. Blank uses
the outbound agent’s key, then the account’s key. HAL sends that key in the `encrypted_key`
header, never in the call body. A rejected caller ID is not automatically retried
with a different number.

If Bland returns **Invalid 'from'**, the error identifies the caller ID, selected
account and whether the value came from the account default or dispatch field.
Correct that source, choose an owned number, or use Bland's default pool.

See [Bland Send Call](https://docs.bland.ai/api-v1/post/calls).

## Inbound testing agents

When the agent under test places the call, HAL must configure the receiving
number before dispatch. Currently this is supported for **Bland structured
simulations**. Use a dedicated test number owned by the selected account and
check the dispatch option to assign the simulation's pathway to it. That
assignment remains after the call. Prompt-only inbound simulations are rejected
rather than silently calling an unrelated/old pathway. The outbound pathway must
also be accessible with the selected provider account's credentials.

The runner normalizes transcript roles for both directions. Calls that time out,
fail, or complete without a transcript are errors, not passing evaluations.
Timeouts do not hang up the provider call; use the provider dashboard to inspect
or stop an active call.

## Self-host with Docker

```sh
docker build -t hal .
docker run --rm -p 127.0.0.1:3000:3000 \
  -e HAL_DATA_DIR=/data -v hal-data:/data hal
```

HAL has no built-in user authentication. Keep it local or behind an authenticated
private gateway. SQLite is the default persistence backend; JSON is the fallback.
Back up the entire data directory, including `secrets.key`. Provider-account
credentials and Settings API keys are encrypted at rest. Existing plaintext
Settings keys are migrated when read. Optionally set a stable `HAL_SECRETS_KEY`
to supply the encryption key yourself; changing it without migrating data makes
existing encrypted credentials unreadable.


## Run details and local recordings

Open a run from **Results** to inspect its transcript, original judge verdict,
individual checks, typed metrics, and the saved agent/judge configuration. New
runs capture snapshots before execution; older runs explicitly show when those
details were not recorded. Applying additional saved judges evaluates the same
transcript and adds separate, timestamped results without overwriting the original
verdict or placing another call.

If hosted polling times out while the provider call continues, open the run and
choose **Check call status and finish run**. HAL checks the existing provider
call, then saves and judges its completed transcript without placing another call.
Selecting a saved testing agent updates its provider graph with the simulation
script and personality before dispatch. Each `say` step becomes its own spoken
turn. Bland uses a Pathway, Vapi a Squad, Retell a Conversation Flow, and
ElevenLabs an Agent Workflow. **Auto** creates a new tester from the script.
HAL reads the main agent's voice ID (or uses the voice ID saved in My agents),
then assigns a different available voice ID to the tester before placing a call.
If it cannot verify two distinct voice IDs, dispatch stops without calling.

New Bland calls request recording and automatically download the audio using the
original provider account. Audio is saved under `HAL_DATA_DIR/recordings` (inside
Electron's persistent user-data directory), then played and sought locally. If
Bland is still processing the recording, use **Download recording** on the run
page to retry. For older calls with a saved call ID, select the Bland account that
placed the call. Calls made with recording disabled may have no audio to retrieve.
Downloading errors do not discard the run or change its verdict. Downloads are
limited to 100 MB; partial files are removed on failure. Back up the data directory
to retain both run history and audio. Recordings are stored as local audio files,
not encrypted secrets.

### Hosted script execution and pathway IDs

Bland dispatch passes the simulation’s linear steps into a newly provisioned
pathway. A `say` followed by `hangup` becomes an End Call node with the exact text.
Untimed `wait` steps after speech separate turns; unsupported steps (including
timed waits, delayed speech, prompts, branches and live assertions) are rejected
before provisioning rather than silently replaced by the persona. Other hosted
providers also compile supported linear scripts into their native graphs. Use
structured simulations for more complex hosted conversations.

Run details capture the script and the tester pathway ID submitted with the call.
For inbound Bland targets, HAL attempts to read the number’s assigned pathway
before dispatch. The page distinguishes this from a saved, unverified target
pathway ID. Older runs without this information remain explicitly unverified.

### Editing and text-based tests

On a simulation page, use **Edit scenario** to change persona instructions,
script steps or structured conditions, then **Save scenario**. Changes apply to
future runs; past run snapshots are preserved. Concurrent edits are rejected so
an older editor cannot silently overwrite a newer scenario.

Hosted testing has **Phone call** and **Chat** modes. Chat executes the saved
scenario as text against a selected Bland pathway, Vapi assistant or squad,
Retell agent, or ElevenLabs agent. It uses the simulation’s judges and saves the
transcript in Results. No phone number is required. Dynamic persona steps and
AI judges also need a configured LLM provider. Chat does not test audio or
telephony behavior. Simulations can be deleted from their table.

Testing agents now have **Edit agent**. Main agents can also be edited. Both offer
an optional **Outbound Twilio credentials** section: select a named saved BYOT
key or store a key on the agent. HAL encrypts per-agent keys locally and does not
return them in agent lists. Only the agent placing a phone call supplies its key;
an inbound agent’s key is ignored. Dispatch overrides take precedence, followed
by the outbound agent’s setting and the provider account default. A removed saved
key produces an actionable error when its assigned agent next calls outbound.

Use **Import existing testing agent** on Testing agents to add a tester you
already built. Choose a provider account and an existing agent (a pathway for
Bland), or paste its ID, then give it a name in HAL. Importing only saves a local
reference; it does not create or modify the provider agent. Duplicate imports on
the same account are rejected. Imported testers retain their provider configuration
for direct calls. Simulation dispatch replaces their test graph with the selected
script and personality, then keeps that graph until the next simulation molds it.
Use **Edit agent** in HAL for their name, ID, or outbound credentials.
