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

Expand **Task usage and policy history**, select a task, and load its saved
observations. Evidence is scoped to the project and Verdictan account. The app
keeps up to 20 observations per run and shows up to 100 recent runs. Settlement
changes are saved even after the native run status stops changing. Missing costs,
tokens, and audit references stay unknown. This is an observed history, not a
complete billing ledger. Earlier runs without an account-bound receipt are not
assigned to the current account.

## Broker-dependent services

Expand **Project governance and knowledge** and check project services. The
runtime must advertise the proposed operations. Kalkidan checks fresh permissions
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

Administrators can create policy templates and apply a selected version to an
installation. Kalkidan blocks application while local agents run or remote hosts
are connected. The broker must validate the target installation, policy ownership,
and template compatibility. It must report partial application.

See [the broker contract](verdictan-project-services-contract.md) for the exact
operations and acceptance cases. The Verdictan owner still needs to implement
and advertise review mutations, Context Fabric, and administrator operations.

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
