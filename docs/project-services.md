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

## EU account configuration

Set `KALKIDAN_VERDICTAN_REGION=eu` before starting Kalkidan. Restart the app after
changing the region. The default is `global`. Other values are rejected.
The EU region uses only `api.eu.verdictan.com` and `console.eu.verdictan.com`.
Its secure broker profile is `kalkidan-eu`; the global profile remains `kalkidan`.
The renderer cannot supply arbitrary endpoints. Region changes do not transfer
credentials or selections between accounts.

The EU account login and setup inspection passed on 2026-10-21. No provider
connections were available. Codex subscription authentication remains an adapter
gap; it is not a substitute for the provider connection used by current native
launches. Local and SSH live model acceptance remains open.
