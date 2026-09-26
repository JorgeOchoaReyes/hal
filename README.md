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
encrypted key** field beside the caller ID. The dispatch value takes precedence
for this call only and is not saved to the agent, account, or run. Blank uses
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
