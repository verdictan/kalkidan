# Data, retention, and user control

This document tells you what Kalkidan keeps, where it keeps it, and for how long. It also
tells you how to export and delete your data, and what happens when you revoke a device, remove
a host, delete an account, or uninstall Kalkidan. The statements agree with the code. The
Settings › Data section shows the same information in the app
(`src/domain/data-policy.ts`).

## Before the first request

After the first sign-in, and before you send the first request, Kalkidan shows the notice
"Where your data goes". It shows one time. Settings › Data shows it again at any time.

The notice has three parts.

### Stays on the execution host

The execution host is this computer or the SSH host where the agent runs.

- Your repositories and code stay there. The agent reads and changes files there.
- Agent conversations stay there: prompts, replies, tool output, and the file content that the
  agent reads. Kalkidan keeps them in `~/.kalkidan/managed-agent-homes` on that host.
- Project documents, project memory, worktrees, session notes, and operation records stay
  there.
- Runtime credentials stay in memory only. They expire in 15 minutes or less. Kalkidan never
  writes them to disk.

### Goes to the model provider

- Each model request goes through the local Verdictan gateway to the provider that you selected.
- A request contains your prompt, the conversation so far, the agent instructions, tool
  results, and the file content that the agent includes. The agent program decides which file
  content to include.
- The request also contains the model name and the request settings.
- With a Claude or ChatGPT subscription, your subscription token goes to that provider.
- Your Verdictan account credentials never go to the provider.

### Verdictan keeps in your selected region

Verdictan keeps this data in the region that you selected (EU or US):

- Your account, organization membership, devices, and hosts. Sign-in sessions keep the IP
  address and the user agent.
- For each model request: the policy decision, a hash of the prompt (not the prompt), the
  provider, the model, token counts, cost, and request identifiers.
- History keeps metadata only by default. The Kalkidan default configuration does not set a
  History capture mode, and the gateway then uses `metadata_only`. If an organization
  administrator sets full capture (`raw`), Verdictan also keeps the prompts and the replies.
- Project context that you publish to project services, and your project search queries.
- An audit trail of account and Console changes, for 90 days.

## Stores and retention

### Local stores on this computer (`~/.kalkidan`)

| Store           | Path in `~/.kalkidan`                                                                                         | Contents                                                                                                                          | Retention                                                              | Export                | Delete                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------- | ---------------------------------------- |
| Chat history    | `managed-agent-homes/`, `sessions.json`, `chat-outcomes.json`, `verdictan-bindings.json`                      | Agent transcripts, session titles and notes, run outcomes (newest 2000), conversation links (identifiers and the repository path) | Until you delete it. Never removed automatically.                      | Yes                   | Settings › Data › Delete chat history    |
| Projects        | `projects/`, `docs/`, `projects.json`, `project-groups.json`                                                  | Project documents, memory (200 entries, 1 MiB for each project), clones, and worktrees that Kalkidan made                         | Until you remove the project. Deleted documents stay in `docs/.trash`. | Documents and memory  | Remove the project                       |
| Preview browser | `browser/`, `Partitions/kalkidan-preview`, Chromium site storage                                              | Visits (newest 500), downloads (newest 100), site data, cookies, imported passwords (encrypted with the OS key store)             | As stated                                                              | History and downloads | Preview browser › Clear browsing data    |
| Caches          | `Cache`, `Code Cache`, `GPUCache`, other Chromium caches, unused `runtime/verdictan/versions/*`               | Chromium caches, old Verdictan runtime versions                                                                                   | Removed first at the disk limit                                        | No                    | Settings › Data › Delete caches and logs |
| Logs            | `operations/`, `Crashpad/`, `logs/`                                                                           | Operation receipts and crash reports                                                                                              | Removed first at the disk limit. Logs newer than 24 hours stay.        | Operation receipts    | Settings › Data › Delete caches and logs |
| Settings        | `preferences.json`, `appearance.json`, `remote-hosts.json`, `verdictan-region.json`, `agent-executables.json` | Your choices, the SSH host list (no keys), the region                                                                             | Until uninstall                                                        | Yes                   | Delete `~/.kalkidan` after you quit      |
| Runtime         | `runtime/verdictan/`                                                                                          | The active and the previous signed Verdictan runtime                                                                              | The active and the previous version stay                               | No                    | Delete `~/.kalkidan` after you quit      |
| Event buffer    | Local event buffer of Kalkidan                                                                                | Usage records and other events that did not reach Verdictan yet                                                                   | 30 days                                                                | No                    | Removed after delivery or after 30 days  |

Outside `~/.kalkidan`:

- The Verdictan CLI keeps the account credentials of the profiles `kalkidan-eu` and
  `kalkidan-us` in the secure storage of the operating system. Sign out to remove them.
- Kalkidan does not change `~/.codex`, `~/.claude`, or the credentials of the `gh` command.
  These belong to those programs. Kalkidan reads the native agent history there, and it reads
  the Claude subscription token from the Claude Code credential store at launch only.
- An agent run uses a temporary folder `kalkidan-agent-*` in the system temporary folder.
  Kalkidan removes it when the run ends.
- An export or a saved chat goes to the folder that you select.

### Disk limit

The data folder `~/.kalkidan` can use up to 2 GB (2,000,000,000 bytes). Kalkidan checks the
limit 1 minute after launch, and then every 6 hours. When the folder is above the limit,
Kalkidan removes data in this order, oldest first, until the folder is within the limit:

1. Logs older than 24 hours (`operations/`, `Crashpad/`, `logs/`).
2. Runtime versions that the installation does not use. During a runtime update, Kalkidan
   removes no runtime version.
3. The Chromium caches.

Kalkidan never removes chat history, projects, browser data, or settings automatically. When
these alone are above the limit, Settings › Data shows a warning. Only you can delete chat
history, in Settings › Data.

The local event buffer has its own limit: 200 MB and 30 days. When it is full, Kalkidan removes
the oldest events that are not usage records first. Usage records stay until Verdictan receives
them.

### Export

Settings › Data › Export copies your data to a new folder `kalkidan-export-<time>` in the folder
that you select. The export contains:

- the JSON stores in the table above,
- the agent transcripts,
- the operation receipts,
- the project documents and memory in `~/.kalkidan`,
- the preview browser history and downloads, and
- `manifest.json` with the list of files.

The export never contains credentials (agent `auth.json` files, Verdictan account or runtime
credentials), saved passwords, cookies, Chromium caches, the runtime, or repository code.

### Delete

- **Delete chat history** removes the agent transcripts, the session notes, the run outcomes,
  and the conversation links. The installation and host identities stay, so that a revoked host
  stays revoked. Stop the agents and disconnect the SSH hosts first.
- **Delete caches and logs** removes the logs, the unused runtime versions, and the Chromium
  caches.
- Every deletion stays inside `~/.kalkidan` and never follows a symbolic link.

### SSH host stores

| Store         | Path on the host                                                                                                        | Contents                                              | Retention                                                       | Delete                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| Helper        | `~/.local/share/kalkidan/agents/<digest>/agent.cjs`                                                                     | The Kalkidan helper, one folder for each version      | Until host removal                                              | Remove host with "Also delete the Kalkidan data on this host" |
| Host data     | `~/.kalkidan/managed-agent-homes`, `operations`, `runtime`, `docs`, `verdictan-bindings.json`, `agent-executables.json` | Host agent transcripts, records, and the host runtime | Until host removal. The 2 GB limit applies with the same rules. | As above                                                      |
| Host projects | `~/.kalkidan/projects/<id>`                                                                                             | Project documents, clones, and worktrees on the host  | Until you remove them                                           | You remove them. Host removal keeps them.                     |
| Gateway locks | `~/.verdictan/desktop-gateways/*.lock`                                                                                  | Lock files of the Verdictan gateway                   | Until removed                                                   | The Verdictan CLI owns them                                   |

The helper runs only during an SSH connection. It installs no service and no scheduled task.
Runtime credentials reach the host gateway through a pipe and never go to disk.

### Verdictan regional stores

Kalkidan does not change how Verdictan keeps data. This table describes the current Verdictan
code (`api/migrations/0001_init.sql`, `api/src/retention-jobs.ts`, and the workers).

| Data                                               | Retention                                                                                                                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit and policy events (`events`)                 | `region_retention_policies` for `audit_events`: 730 days in `eu_sovereign` regions and 2555 days in `us_commercial` regions by default. The retention worker runs every 5 minutes. |
| History sessions and entries                       | `region_retention_policies` for `history_entries` (same defaults), and the gateway `expires_at` of each entry (1 to 2555 days). The search index entries go with them.             |
| Console audit trail (`trail_events`)               | 90 days, fixed. `trail_configuration.retention_days` stays in the schema but does not control retention.                                                                           |
| Product reporting detail                           | 90 days                                                                                                                                                                            |
| Activity facts                                     | Each fact has `retention_tier` `standard`, `extended`, or `compliance`.                                                                                                            |
| Usage and billing ledger (`spend_logs` and others) | Kept. Organization deletion keeps the billing ledger.                                                                                                                              |
| Export artifacts                                   | `VERDICTAN_EXPORT_RETENTION_DAYS`, 90 days by default. An export job can set `retention_days`.                                                                                     |
| Notification outbox                                | `purge_after`, 90 days                                                                                                                                                             |
| Telemetry blobs (`telemetry_blob_refs`)            | The `telemetry_blobs` regional policy. Without a policy, a reference has no expiry.                                                                                                |
| Sessions, runtime ownership, host revocations      | No age limit. They go with organization deletion. A host revocation is permanent.                                                                                                  |

Export in Verdictan: Console › History, the activity and event exports, and the export jobs.
Erasure: an administrator can request crypto-shred erasure for a data subject in a region.

## Revocation

You can revoke access in the Console, in **Account › Devices and hosts**:

- **Revoke host** revokes one execution host.
- **Revoke device** revokes one Kalkidan installation. It revokes all hosts of the
  installation and signs out Kalkidan on that device. Your Console session stays signed in.

The maximum revocation delay is:

| Condition                                  | Delay                       |
| ------------------------------------------ | --------------------------- |
| A new request with a revoked credential    | None. Verdictan refuses it. |
| A running runtime that can reach Verdictan | 10 seconds or less          |
| A runtime that cannot reach Verdictan      | 5 minutes or less           |

How it works:

1. Verdictan checks each runtime credential on each request, without a cache. The next request
   after a revocation fails.
2. The Verdictan gateway on the execution host checks the revocation status of its runtime every
   10 seconds. When the runtime is revoked, the gateway stops at once. It tells Kalkidan with
   the event `credential.revoked`.
3. Kalkidan then stops the agent, drops the runtime credentials from memory, and keeps the
   runtime in the revoked state. When the host is revoked, Kalkidan blocks new runtimes on that
   host. When the device is revoked, Kalkidan signs out and removes the local account
   credentials.
4. When the gateway cannot reach Verdictan for 5 minutes, it stops. This is the offline backstop.

A provider request that Verdictan authorized before the revocation is not undone. Local data
stays after a revocation. To delete it, use Settings › Data.

## End of use

| Action                                                 | Effect                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remove an SSH host                                     | Kalkidan revokes the host in Verdictan, disconnects it, and forgets its identity. With "Also delete the Kalkidan data on this host", Kalkidan first deletes the helper and the host data. Host project folders stay.                   |
| Revoke a device or a host in the Console               | See [Revocation](#revocation). Local data stays.                                                                                                                                                                                       |
| Leave an organization, or an administrator removes you | Verdictan revokes the API credentials that you made or that act for you, and removes the membership. Running runtimes stop within the revocation delay. Local data stays until you delete it.                                          |
| Delete the organization                                | Verdictan deletes the organization data 30 days after the request. You can cancel during this time. The billing ledger stays. Users who belong only to that organization are deleted too.                                              |
| Delete your account                                    | Verdictan has no self-service account deletion. Ask your organization administrator to remove you, or delete the organization.                                                                                                         |
| Uninstall Kalkidan                                     | Removing the app does not delete `~/.kalkidan`. First sign out (this removes the account credentials), remove your SSH hosts with "Also delete the Kalkidan data on this host", and then delete `~/.kalkidan` after you quit Kalkidan. |

## Resource ownership

Removal touches only the resources in this table. Kalkidan never removes a folder that you
selected, a repository that you registered, or the files of another program.

| Resource                              | Created by                                        | Location                                                                       | Uninstall                     | Host removal                                              | Account deletion                             |
| ------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------- | --------------------------------------------------------- | -------------------------------------------- |
| Data folder                           | Kalkidan                                          | `~/.kalkidan` on this computer                                                 | You delete it                 | Not changed                                               | Not changed. Credentials there stop working. |
| Account credentials                   | Verdictan CLI, for Kalkidan                       | OS secure storage, profiles `kalkidan-eu` and `kalkidan-us`                    | Sign out first                | Not changed                                               | Verdictan revokes them. Kalkidan signs out.  |
| Runtime credentials                   | Verdictan, for each runtime                       | Memory only                                                                    | Gone when Kalkidan quits      | Revoked                                                   | Revoked                                      |
| Installation and host identities      | Kalkidan                                          | `~/.kalkidan/verdictan-bindings.json` and Verdictan                            | You delete the folder         | Kalkidan revokes the host and forgets its identity        | Verdictan deletes them with the organization |
| Agent transcripts                     | The agent program, in a folder that Kalkidan made | `~/.kalkidan/managed-agent-homes` on each host                                 | You delete the folder         | Kalkidan deletes them when you select it                  | Not changed                                  |
| Default project folders               | Kalkidan                                          | `~/.kalkidan/projects/<id>`                                                    | You delete the folder         | Kept                                                      | Not changed                                  |
| Folders that you selected             | You                                               | Any path                                                                       | Not changed                   | Not changed                                               | Not changed                                  |
| Git worktrees                         | Kalkidan                                          | The project `worktrees/` folder, registered in the repository `.git/worktrees` | Remove them in Kalkidan first | Kept                                                      | Not changed                                  |
| Helper                                | Kalkidan                                          | `~/.local/share/kalkidan/agents` on the host                                   | You remove it on the host     | Kalkidan deletes it when you select it                    | Not changed                                  |
| Host runtime and data                 | Kalkidan                                          | `~/.kalkidan` on the host                                                      | You remove it on the host     | Kalkidan deletes it when you select it, except `projects` | Not changed                                  |
| Gateway lock files                    | Verdictan CLI                                     | `~/.verdictan/desktop-gateways`                                                | The Verdictan CLI owns them   | Not changed                                               | Not changed                                  |
| Native agent history                  | Codex and Claude Code                             | `~/.codex`, `~/.claude`                                                        | Not changed                   | Not changed                                               | Not changed                                  |
| GitHub sign-in                        | `gh`                                              | The `gh` credential store                                                      | Not changed                   | Not changed                                               | Not changed                                  |
| Account, devices, and request records | Verdictan                                         | Your selected region                                                           | Not changed                   | The host is revoked                                       | See [End of use](#end-of-use)                |
