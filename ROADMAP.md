# HAL roadmap

This roadmap covers planned work. It does not change the current simulation or agent flows.

## 1. Bulk runs across simulations

Run a selected set of simulations as one job, with an optional repeat count for each simulation. The existing batch runner handles repeated runs of one simulation; this work extends that experience across several simulations and hosted providers.

- Select simulations, run count, execution order, and a safe concurrency limit before starting.
- Show estimated call count and which provider accounts will be used.
- Save a batch record and each result as soon as it starts, so progress survives leaving the page or restarting the app.
- Show queued, running, completed, and failed items. Allow stopping work that has not started and opening each result.
- Summarize pass rate and judge outcomes for the whole batch without hiding individual failures.

**Done when:** A user can launch a mixed selection, leave the page, return to live progress, and inspect every completed or failed run.

## 2. Run a whole folder

Start a bulk run from a simulation folder. This builds on the bulk job above and uses the saved folders already shown on the Simulations page.

- Show the folder's simulations and total planned runs for review before dispatch.
- Snapshot folder membership and simulation versions at launch, so later edits or moves do not silently change an active job.
- Let the user set repeats and concurrency for the folder run.
- Link the batch summary back to its source folder and provide a clear empty-folder state.

**Done when:** One action can run every simulation in a folder, and the resulting batch shows exactly which simulations and versions ran.

## 3. Agent chat option

Offer a direct chat session with a saved main agent or testing agent from the agent views. Simulation chat already exists; this option is for exploring an agent without first creating or choosing a simulation.

- Choose the agent and provider account, start a new session, and send messages in a persistent conversation view.
- Show the agent's replies, tool activity, and available provider metadata with the conversation.
- Make provider support and setup requirements clear before starting; do not show a chat action for an unsupported configuration.
- Allow a useful conversation to be turned into a simulation script later.

**Done when:** A user can open a saved agent, chat with it, revisit the conversation, and use that conversation as input to a simulation.

## 4. Self improving tab

Add a dedicated place to learn from run results and propose better simulation scripts, testing agent behavior, or main agent configurations. Start with reviewable suggestions rather than automatic changes to provider agents.

- Gather failures and judge feedback from individual and bulk runs, grouped by simulation, folder, and agent.
- Show the evidence for each proposed change: relevant transcript turns, activity, metadata, and judge findings.
- Generate a candidate revision and compare it with the current version before the user accepts it.
- Run the candidate against a selected set of simulations, compare outcomes with the baseline, and keep a version history with rollback.
- Apply an accepted change only to the explicitly selected simulation or agent configuration.

**Done when:** A user can move from a failing run to an evidence-backed candidate, test it, and explicitly accept or discard it while retaining the original version.

## Suggested order

Build bulk runs first, then folder runs on top of the same job and progress model. Agent chat can follow independently. Build the self improving tab after durable batch history and result comparison are available.
