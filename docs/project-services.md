# Project services

## Current delivery state

The current working tree adds automatic task dispatch, saved task evidence, and a
client for the proposed Verdictan project-services contract. These changes are
not yet released. The Verdictan repository is unchanged.

## Automatic dispatch

Open the project's Tasks page. Expand **Automatic agent dispatch**. Select issues,
repositories, an agent, and one to four parallel slots. Prepare the plan, review
the prompts, then select **Start reviewed tasks**.

Each task gets a separate worktree. The backend checks the GitHub issue, repository
origin, and blockers again before launch. Changes after review stop that task.
Plans and operation IDs survive restart. A task cannot enter two unresolved
plans. A lost launch response pauses the queue. The app does not replay its prompt.
Cancel stops the queue and requests stops for its owned agents. An unconfirmed
start or stop remains visible and keeps its task reserved. Review the native
session before resolving an uncertain outcome.

## Task evidence

The **Usage** section shows the observations that this computer saved for each
task run. Select a task to load them. Evidence is scoped to the project and Verdictan account. The app
keeps up to 20 observations per run and shows up to 100 recent runs. Settlement
changes are saved even after the native run status stops changing. Missing costs,
tokens, and audit references stay unknown. This is an observed history, not a
complete billing ledger. Earlier runs without an account-bound receipt are not
assigned to the current account.

## Verdictan history

Verdictan owns the history. It is one history for chats and tasks. Kalkidan
reads it with `history.list` and a `history_scope`: the organization and the
correlation keys of the chat (`conversation_id`) or of the task (`project_id`
and `task_id`). The backend reads the keys from the chat binding or the project
board. The renderer sends only the chat or the task and never sees an ID.

Verdictan 0.6.5 removed `task.history`. Kalkidan uses only `history.list`. When
the runtime does not advertise `history.list`, tasks and chats have no history.
Each row shows the policy decision, reason, model, token counts, timings,
measured cost and settlement. A late settlement that completes a released authorization shows
"Corrected after release". Unknown values stay unknown. **Load again** starts
without a cursor, so it shows corrections and later requests.

Kalkidan sends `x-verdictan-desktop-run-id` with each request. A project-bound
runtime rejects requests without it.

## Default policy and agents

Kalkidan owns projects. Verdictan is the gateway control plane. One default
Kalkidan configuration replaces the earlier per-project templates.

### First connect

After sign-in, the managed agent setup reads `setup.inspect`. When
`readiness.bootstrap` is `bootstrap_available` and the runtime advertises
`setup.bootstrap`, Kalkidan sends `setup.bootstrap` one time. Verdictan then
makes the default configuration and the Kalkidan agent, and deploys the
configuration to the agent. Kalkidan sends the team of a saved selection, when
there is one. Then Kalkidan reads `setup.inspect` again. Launches never send a
setup operation. Other readiness values never send it.

An older runtime does not advertise `setup.bootstrap`. Then Kalkidan uses
`setup.ensure_default` when `readiness.policy` is `default_creatable`.

A member gets `bootstrap_requires_admin` or `desktop.setup_bootstrap_required`.
The setup shows a note: "Ask an organization administrator to finish Kalkidan
setup." This is not an error.

### Agent choice

When `setup.inspect` sends `agents`, the setup shows an **Agent** choice in
place of the team and policy choices. It shows service names. An agent without
a name shows "Kalkidan agent" (the default) or "Agent 1". The policy of each
agent is the secondary text. The Kalkidan agent is selected first.
`resources.provision` then sends `agent_id` and the team of the agent, and no
policy IDs. Kalkidan checks `agent_source` and `configuration_source` in the
response and binds the chat to the deployed version. Each agent kind (Codex or
Claude Code) keeps its own choice. A runtime without `agents` keeps the team and
policy choice.

### Removed default

Verdictan does not make the default again after an administrator removes it.
When `bootstrap.configuration_status` or `bootstrap.agent_status` is `deleted`,
or `readiness.policy` is `default_removed`, the setup shows a note and the user
must choose another agent. Without another agent, the note tells the user to
ask an organization administrator for access to an agent. A launch with the
removed default gets `desktop.setup_default_removed` and links to the setup
step.

For `default_configuration_required` and `default_permission_required`, the
setup step tells the user to ask an organization administrator. A launch that
gets one of these errors links to the same step.

## Broker-dependent services

Expand **Managed agent services** and check project services. The runtime must
advertise the operations. Kalkidan checks fresh permissions
before every request. The broker must enforce the same permissions on its API.
An older runtime shows an unavailable state.

Review decisions require a reason, current revision, and explicit confirmation.
They do not restart an agent. Lost mutation responses retain their operation ID.
Use **Check operation outcome** before another action.

Context Fabric starts disabled. Enable it explicitly for each project. Search only
when needed. Retrieval has passage and character limits. Results need source
provenance. Publication reads the reviewed document from project storage again;
it rejects a changed revision. Delete actions need current permission and a
reviewed revision. Project consent does not enable automatic Docs retrieval.

Verdictan removed the template operations `admin.templates`,
`admin.template.save`, and `admin.template.apply`. Kalkidan has no template UI,
IPC, or preload method. Use the default policy instead.

See [the broker contract](verdictan-project-services-contract.md) for the exact
operations and acceptance cases.

## Runtime approval maintenance

Use an independently reviewed pin and its exact manifest. First inspect the change:

```sh
npx tsx scripts/approve-runtime.ts manifest.json reviewed-pin.json darwin arm64 26.7.1
```

Add `--apply` to update the bundled host policy. Review the Git diff. Run bundled
policy tests and `tests/acceptance/runtime-install.ts` on that host. Commit the
policy and evidence together. Discovery alone must not approve a runtime. The
script checks manifest validity, expiry, target, digest, and downgrade sequence.
Use the operator-reviewed download origins. Renew approval before its manifest
expires. Do not relax hash, target, or expiry checks to use an unapproved release.

## Account region

Open **Settings**, then **Managed agents**. In step 2, **Sign in**, select
**European Union** or **United States** in **Account region**. Then sign in. The first
selection applies immediately. A later change asks you to confirm, because it stops work. Kalkidan saves the region in
`verdictan-region.json` in the app data folder. An operator can preselect a region:
set `KALKIDAN_VERDICTAN_REGION=eu` or `KALKIDAN_VERDICTAN_REGION=us` before the
first start. A saved region has priority. Other values leave the region unselected.

Each region uses only its own fixed origins and secure broker profile:

| Region | API                    | Console                    | Profile       |
| ------ | ---------------------- | -------------------------- | ------------- |
| EU     | `api.eu.verdictan.com` | `console.eu.verdictan.com` | `kalkidan-eu` |
| US     | `api.us.verdictan.com` | `console.us.verdictan.com` | `kalkidan-us` |

The renderer cannot supply arbitrary endpoints. A region change stops active work,
disconnects SSH hosts, and starts a new account owner. Region changes do not
transfer credentials or selections between accounts.

Kalkidan does not use the Global region (`api.verdictan.com`). That host redirects
each request to a regional host. An authenticated request must not follow a
redirect to another host, so sign-in and account requests fail there. If your
saved region is `global`, Kalkidan keeps the region unselected and asks you to
select EU or US. It does not select a region for you. Kalkidan does not use the
earlier `kalkidan` profile. To remove that local session, run
`verdictan auth logout --profile kalkidan`.

Project-service operations come from the signed-in account profile. Kalkidan
reads them again after sign-in, sign-out, session renewal, and a region change.
The signed-out compatibility probe checks only the runtime version.

The EU account login and setup inspection passed on 2026-10-21. No provider
connections were available. Codex subscription authentication remains an adapter
gap; it is not a substitute for the provider connection used by current native
launches. Local and SSH live model acceptance remains open.
