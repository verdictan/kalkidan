# Implementation Plan: Project and Agent Features

## Current status — 2026-10-21, no Verdictan pin (latest signed release, now 0.6.9)

This section replaces the earlier verification, acceptance, and follow-up notes.
It is a work record, not a release-acceptance certificate.

### Completed

- Kalkidan main `4712c5c`:
  - PR #20, #22, #25: Claude subscription adapter, explicit region, verified
    desktop self-update, managed-only launches, names without raw IDs, default
    configuration on first connect, one Verdictan history.
  - PR #26, #27, #29: Verdictan 0.6.3 to 0.6.5 pins (superseded by PR #34).
    The `task.history` fallback is removed.
  - PR #28, #30, #31: install refresh, region switch, setup fallback, add-folder
    dialog closes after a new project, composer clears after a refused send,
    refused chats stay unsaved with a note.
  - PR #32: one-time organization bootstrap and the agent picker.
  - PR #33: minimum agent versions. Codex 0.160.0 or later, Claude Code 2.1.300
    or later. No exact agent version is pinned.
  - PR #34: no Verdictan pin. Kalkidan installs and auto-updates to the newest
    stable Verdictan release that the Verdictan release key (cosign P-256)
    signs. Operator runtime policy and the approval scripts are removed. Remote
    helper protocol is 5.
  - PR #35: runtime discovery uses the github.com latest-release redirect and
    `sha256.sum`. The rate-limited GitHub API is only a fallback.
  - PR #36: a launch waits up to 30 seconds for a running status check, so the
    first send after app start is not refused.
  - PR #37: after a refusal, later requests in the turn repeat the first refusal
    reason instead of a generic 409.
  - PR #38: account results keep the selected region (no "Region not selected"
    after a runtime update).
  - PR #39: chat history reads the `claude-subscription` and `codex-subscription`
    managed homes, so subscription chats show in All chats and the project.
  - PR #40, #41: restored chats show only the user's text and titles. Kalkidan's
    project context, `system-reminder` blocks and Claude Code 2.1.306
    `api-request-blob` records are not shown.
  - UX review (https://claude.ai/artifact/UWKRZSVPprMiRAbAjTHsgz), all merged:
    PR #42 Now fixes (menus inside the window, Agents overflow, Commit state,
    calls to action, usage duration and subscription cost, specific refusal
    reasons with a relayed gateway code allowlist); #43 command palette overlay;
    #44 agent programs per computer including SSH, with a chosen program; #45 and
    #46 Insights from managed-agent usage; #47 one chat action list and a model
    chip; #48 "@" picker for files, docs, tasks, memory and chats; #49 Settings
    as a page with five tabs; #50 simpler sidebar, one project header and one
    project settings dialog. Checked in the app on 22 Oct 2026.
  - Removed on the owner's request: signed runtime binaries (verdictan/work#710
    and verdictan/jenkins-library#38 closed) and local tasks (never merged).
- Verdictan 0.6.6 (bootstrap, provider resolution, real refusal codes, schema
  parity phase 1, Keychain wait), 0.6.7 (no native agent version pins in the
  gateway) and 0.6.8 (well-formed Anthropic beta tokens pass through, desktop
  readiness retries one transient failure and logs the reason; work #705, #706)
  and 0.6.9 (desktop-supervised gateways skip the managed public endpoint
  admission check, so a second host on the same agent passes readiness; work #708)
  are public.
- Verdictan API: opaque project keys, desktop sessions valid until JWT expiry,
  default configuration with the wildcard provider target, `history.list`,
  Context Fabric project knowledge, deprecated tables dropped, team and
  configuration names in `setup.inspect`.
- Live acceptance (helper and broker level): C11 on 0.6.2, C12 over SSH on
  0.6.2, C13 lost-response recovery on 0.6.3.
- In-app on 0.6.8 (macOS, Claude Code 2.1.306, Claude subscription): automatic
  signed runtime update 0.6.7 to 0.6.8, sign-in, setup, local managed Claude chat
  ("pong", policy Allow, usage 19,444 tokens, audit ingested), restart recovery,
  and the history view passed.
- In-app SSH on 0.6.9 (Linux host dennisotugo@192.168.1.142, Claude Code 2.1.304
  from Homebrew on PATH, Claude subscription): signed Linux runtime install,
  automatic update 0.6.8 to 0.6.9, remote project and folder, managed Claude chat
  ("pong", policy Allow, usage 19,453 tokens, audit ingested) passed.

### Remaining

| Item                                                                                                        | Owner     | State                                                |
| ----------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------- |
| Computers card: "Update Kalkidan helper" is still under Manual setup, while Updates says to update it there | Kalkidan  | Follow-up.                                           |
| Insights intro reuses "A missing value is unknown. This is not a bill."                                     | Kalkidan  | Follow-up: use the reworded Usage history text.      |
| Insights took about 20 seconds to load for 4 chats                                                          | Kalkidan  | Follow-up: read chat histories in parallel or cache. |
| Agents › managed setup shows "Use this setup" for a setup that was saved before                             | Kalkidan  | Follow-up: confirm saved state detection.            |
| Two "How this works" disclosures on Settings › Agents                                                       | Kalkidan  | Follow-up.                                           |
| Status dots have no failed or refused state                                                                 | Kalkidan  | Needs per-chat outcome tracking.                     |
| A broker that saw a Keychain refusal stays failed until app restart                                         | Kalkidan  | Follow-up.                                           |
| Kalkidan desktop update check uses the rate-limited GitHub API                                              | Kalkidan  | Follow-up.                                           |
| Insights and Usage history skip chats on SSH hosts                                                          | Kalkidan  | Follow-up.                                           |
| Readiness 503 root cause                                                                                    | Verdictan | 0.6.8 logs the step. Not seen again.                 |
| Schema parity phase 2 (draft verdictan/work#697)                                                            | Verdictan | Merge after observing `/readyz` warnings.            |
| Keychain prompt on each runtime update                                                                      | Owner     | Signing was dropped; prompts continue.               |

### Limits

- Fixture results do not count as live acceptance.
- Linux runtime trust comes from the archive signature. The signed manifest has
  no Linux artifact, so Linux has no minimum OS check.
- Runtime discovery and install need the network. Launch does not.
- Windows isolation, the Tests and CI workstream, and GitHub Enterprise remain
  out of scope.

## Scope and delivery rules

Updated on 2026-10-21. The active scope is native agents, GitHub project
administration, GitHub Projects API coverage, recovery/state machines, and
updates/installation. The user removed the Tests and CI and Windows isolation
workstreams. Existing tests, release configuration, and fail-closed launch rules
remain. This file tracks work; it is not a release-acceptance certificate.

## Merge and publication record — 2026-10-21

The implementation was merged through [PR #16](https://github.com/verdictan/kalkidan/pull/16).
The merge commit is `4a1a9a9696ec3c77d824e9641481940298db4c79`.

- [PR validation #1](https://jenkins.dennisotugo.com/job/verdictan/job/kalkidan/job/PR-16/1/)
  passed before the merge.
- The main push automatically started
  [main build #17](https://jenkins.dennisotugo.com/job/verdictan/job/kalkidan/job/main/17/).
  Validation passed and started the trusted release job without a manual trigger.
- [Release #288](https://jenkins.dennisotugo.com/job/verdictan/job/trusted/job/kalkidan-release/288/)
  passed. It published
  [Kalkidan 0.1.0-build.1792540587.4a1a9a9696ec](https://github.com/verdictan/packages/releases/tag/kalkidan-v0.1.0-build.1792540587.4a1a9a9696ec).
- The public release contains eight packages: macOS ARM64 and x64 DMG/ZIP,
  Windows x64 EXE/ZIP, and Linux x64 AppImage/DEB. It also contains `SHA256SUMS.txt`.
  The release was verified as public and latest after publication.
- The [Homebrew cask](https://github.com/verdictan/homebrew-tap/blob/main/Casks/kalkidan.rb)
  was updated to this version. Both DMG checksums match the published asset digests.
- The Linux validation container now uses Node 24.21.0. The native worktree
  recovery test runs in `npm test`; it is excluded from the offline suite because
  it starts real Git processes. Both suites passed.

Packaged-app checks passed in the release pipeline. This does not establish an
installation over an existing user profile or an upgrade with data preservation.
Publishing the Windows app does not establish managed Windows-agent isolation.
At the post-release check, main #17 and release #288 were complete and neither
job was queued. No deployment work remained running for this release.

## Current implementation

| Area                   | Implemented behavior                                                                                                                                                                                                     | Evidence and limits                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native agents          | Managed launch, immutable bindings, local/SSH broker routing, isolated homes, OS containment, prompt dispatch receipts, question handling, cancel/resume/fork, and inference retry guard.                                | Real pinned Codex and Claude binaries passed 28 conversation cases and four containment cases on macOS/Linux using synthetic providers. Full live account/gateway journeys are not claimed. |
| Project administration | Create/copy/delete, templates, metadata, visibility, close/reopen, repository/team links, and collaborator role writes.                                                                                                  | Fresh permission and revision checks; source-scoped IDs. Collaborator enumeration is not exposed by the reviewed API.                                                                       |
| Projects API           | Fields/options/iterations, issue fields, item lifecycle, saved views and server filters, status updates, workflow reads/deletion, issue/PR editing, hierarchy, dependencies, and reviewed batch edits.                   | 50 mutation, 79 output-type, and 18 REST-path snapshots. See the API coverage inventory for verified public API limits.                                                                     |
| Recovery               | Workspace routes, project creation, agent starts, task status sync, commit/push/PR, worktrees, resource revisions, reconnect queue, SSH helper setup, and runtime installation have explicit owners and recovery states. | Cross-process leases and durable receipts cover operations that must not repeat. Interactive project mutations also have private receipts and explicit uncertain-write review.              |
| Updates                | Desktop release inventory, paginated runtime discovery, approved runtime installation, stale/error state, cancellation, rollback, helper version history, and externally managed agent inventory.                        | Real v0.3.0 runtime clean install/restart/capability probes passed on macOS/Linux. Download discovery does not approve an unreviewed runtime.                                               |

Managed Memory, interactive questions, shared board caching, Docs/Memory resource
loading, and background reconnection are implemented in the source. Their required
behavior below remains the regression contract.

## Project workflow implementation

The Tasks page now includes these explicit workflows:

- Docs-to-issues: choose a document, edit its heading breakdown, review the target
  repository and relationships, then publish. Source references are opt-in. Memory
  is never read. Durable receipts recover created drafts and stop uncertain writes.
- Iteration planning: choose estimates, priority, dependencies, and remaining
  capacity. Review exclusions and apply selected changes through the batch journal.
- Agent and release readiness: inspect current issues, blockers, linked sessions,
  closing PRs, head revisions, and paginated check evidence. Propose bounded waves
  with separate worktrees. Start each task through its existing inspector. This is
  a proposal, not an automatic dispatcher or an exclusive assignment lock.
- Portfolio and personal work: read up to 20 connected projects with one frozen
  credential, retain source identities, and filter by GitHub assignee. Failures
  remain visible per project. No local task board is created.

Jenkins evidence comes from check/status records that Jenkins reports to GitHub.
Missing evidence remains incomplete. The app does not infer a successful release
from a successful agent exit or mark tasks Done automatically.

## External acceptance boundaries

Do not mark these items complete from a schema snapshot or an offline fixture:

- Full application-level local/SSH acceptance against an authenticated Verdictan
  account, gateway, policy, and billing environment. Native provider-fixture runs
  and broker unit tests are separate evidence.
- Desktop installation and upgrade acceptance: install the published package over
  an existing version, preserve project data, and reopen successfully. Package
  creation and packaged-app checks passed; this upgrade journey has not been run.
- Runtime approval maintenance: the bundled reviewed runtime remains v0.3.0.
  Review new artifacts and compatibility before changing the pins. Discovery does
  not approve installation, and approval metadata expires after seven days.

GitHub Enterprise is outside the implemented support boundary. The app accepts
GitHub.com only. Public API limitations are recorded in
`github-projects-api-coverage.md`; unavailable operations remain GitHub-side actions.
Work proposals require explicit task starts. Desktop updates require an explicit
download, installation, and restart. These boundaries are not running background work.

## Verification record

On 2026-10-21, 320 unit tests pass. Type checking, lint, production build, and
architecture checks pass. All 96 browser tests and the Electron smoke test pass.
The native acceptance and runtime installation records identify their exact
boundaries in `native-agent-acceptance.md`. No production board writes were used.

## 1. Managed project memory

### Required behavior

Keep Memory non-editable in the project UI. Agents must save reusable knowledge
through a managed service. Markdown remains the readable source of truth.

Store verified conventions, decisions, recurring fixes, and explicit preferences.
Do not store raw transcripts, temporary progress, credentials, or unsupported
inferences. A model-generated candidate is not automatically a verified fact.

### Implementation

- Extend `src/domain/memory.ts` with a versioned entry, candidate, and operation
  result. Include entry ID, topic, content, revision, source session/turn, source
  references, timestamps, and superseded entry IDs.
- Add a service under `electron/storage/` for list, read, search, upsert, and
  supersede operations. Keep the existing reader as the migration input.
- Require the expected revision on updates. Serialize writes per project, use
  atomic replacement, and reject stale revisions with a conflict result.
- Validate names, sizes, project ownership, and path containment. Reject symbolic
  links. Make the project root and execution host part of the storage identity.
- Give agents a scoped memory tool through the supported agent tool mechanism.
  Bind project, host, and session identity in the backend. Do not trust project
  IDs or filesystem paths supplied in tool arguments.
- Replace the instruction to write arbitrary memory files with instructions to
  use that tool. Apply one service contract to local and remote sessions.
- Add an extraction queue after successful turns with useful source material.
  Run it in the background, outside the user's active conversation context.
  Use the project's supported agent runtime; do not add a new paid model service.
- Bound extraction input and output. Proposed defaults: 12,000 input characters,
  five candidates, and 2,000 characters per candidate. Set these in configuration.
- Key each extraction job by project, host, session, and completed turn. Persist
  its result so restart or duplicate completion events cannot save duplicates.
- Validate candidate structure and source references. Reject unsafe content.
  Defer ambiguous candidates instead of silently treating them as facts.
- Deduplicate exact normalized content. Use explicit supersession for conflicting
  decisions. Keep provenance when consolidating related entries.
- Search topics on demand and return bounded excerpts. Proposed retrieval budget:
  three entries and 4,800 characters. Do not inject all memories into every turn.
- Index file revisions. Detect external edits, validate them, and mark their
  provenance as external. Do not delete an external edit during consolidation.
- Publish a project-scoped change event after a successful write. Expose the
  last extraction outcome and any failure in the read-only UI.

Extraction states: `queued → extracting → validating → saved | skipped | failed`.
Cancellation must release resources. Failed extraction must not fail the user turn.
Storage states are separate from extraction states.

Migrate existing Markdown entries without changing their text. Assign stable IDs
and mark missing provenance as `legacy`. Support interrupted migration recovery.

### Acceptance and tests

- A successful agent operation creates a revisioned entry on the correct host.
- Replaying the same completed turn does not create another entry.
- Conflicting writes preserve the stored entry and return an explicit conflict.
- Tests cover extraction failure, missing sources, secret-like content, duplicate
  candidates, external edits, symlinks, truncated files, and interrupted writes.
- Remote disconnection leaves extraction retryable. It never reports a false save.
- The UI cannot directly edit Memory. A fresh view reflects a saved entry.

Primary files: `electron/projects/prompt.ts`, `electron/storage/project-memory.ts`,
`electron/interactive-chat.ts`, `electron/remote-agent.ts`,
`src/domain/memory.ts`, `src/components/project-memory.tsx`.

## 2. Interactive agent requests

### Required behavior

Show agent questions and permission requests in the conversation. Return the
user's answer to the originating request exactly once. Keep questions distinct
from permissions; an answer must not grant unrelated tool access.

### Implementation

- Capture request fixtures from the supported Codex and Claude runtime versions.
  Document the supported protocol versions and exact response envelopes.
  Do not guess method names or claim support for unknown request types.
- Extend `src/domain/conversation.ts` with a discriminated request model:
  permission, text question, single choice, and multiple choice.
- Include run ID, request ID, provider, question IDs, labels, options, required
  fields, cancellation support, and expiration status.
- Add `chatRespond` to the API contract, preload, sender-validated IPC handlers,
  remote method allowlist, and remote-agent dispatch.
- Map provider requests into this model and map answers back in provider adapters.
  Route approval controls through the same lifecycle while preserving their scope.
- Validate answer types, allowed options, required fields, and size limits on the
  backend. Reject replies from a different run, window, or execution host.
- Show pending requests after a conversation panel remount. Preserve an unsent
  answer in renderer state. Do not record sensitive answers in diagnostic logs.
- Support request cancellation, run termination, and provider cancellation events.
  A transport timeout is not a user denial. Show expiration explicitly.
- Keep unknown requests on a typed unsupported path. Explain the missing
  capability in the UI and provide a supported terminal fallback where available.
- On app or agent restart, expire requests whose transport no longer exists.
  Do not replay answers into a different process.

Request states: `pending → submitting → answered | rejected | expired | canceled`.
Submission failure returns to `pending` only if the backend proves that no answer
was delivered and the original request remains active.

### Acceptance and tests

- Fixture tests cover each supported provider request and response shape.
- The user can answer all supported question types through both local and SSH
  sessions. Browser tests exercise keyboard use and focus handling.
- Duplicate clicks produce one response. Malformed and late replies are rejected.
- Tests cover multiple outstanding requests, cancellation, disconnect during
  submission, wrong-run replies, unknown methods, and terminal cleanup.

Primary files: `electron/interactive-chat.ts`, `electron/chat.ts`,
`electron/preload.ts`, `electron/main.ts`, `electron/remote-agent.ts`,
`src/api/contracts.ts`, `src/domain/conversation.ts`, `src/domain/host.ts`,
`src/components/conversation.tsx`.

## 3. Shared backend board caching

### Required behavior

Use one backend board service for UI loads, task context, workflow validation, and
status mutations. Avoid independent board fetches for the same account and board.

### Implementation

- Add a board service under `electron/trackers/`. Keep provider HTTP operations
  behind the provider adapter. Remove direct board reads from consumer code.
- Key entries by provider, service endpoint, authenticated account identity, and
  provider project ID. Local project IDs alone are not sufficient.
- Use a bounded least-recently-used cache and one pending read per key.
  Proposed defaults: 32 boards, 60-second freshness, and a 16 MiB total payload
  budget. Evict oversized results after serving the caller.
- Expose read policies: cached display, fresh validation, and forced refresh.
  Display reads may return stale data with status. Mutations and task validation
  must not silently use expired data.
- Return revision, fetched time, freshness, and error information with board data.
  Pass these to the renderer state machine instead of hiding refresh failures.
- Use generation counters. A fetch started before a mutation must not replace a
  newer result. Do not replay a mutation when retrying a failed read.
- Invalidate after status changes, item creation/import, relinking, sign-out,
  account changes, and GitHub host removal. Notify all open windows.
- Invalidate after an uncertain mutation outcome, then reconcile with a read.
  Do not assume a timed-out mutation failed before repeating it.
- Separate provider mutation transport from validation so status updates do not
  recursively call the cached service or fetch the full board twice.
- Handle rate limits through typed retry metadata. Coalesce retries and respect
  provider delay information. Bound queued work and retry attempts.
- Keep raw board payloads in memory. Do not persist private task bodies as cache
  files. Record cache hit/miss and coalesced-read counts without task contents.
- Reuse this service for legacy handlers during the code change, then remove
  legacy handlers with the GitHub API cutover in section 6.

### Acceptance and tests

- Concurrent requests from multiple windows and task-context generation result in
  one provider read for the same key.
- Separate accounts or endpoints never share board data.
- Tests cover expiry, byte limits, eviction, rate limits, partial pagination,
  failed refresh, mutation races, relinking, and sign-out during a pending fetch.
- A successful mutation causes one authoritative refresh, with matching results
  in all open windows.

Primary files: `electron/trackers/registry.ts`, `electron/trackers/ipc.ts`,
`electron/trackers/github.ts`, `electron/github-projects.ts`,
`electron/projects/prompt.ts`, `src/hooks/use-project-board.ts`.

## 4. Docs and Memory loading

### Required behavior

Use explicit resource states and shared request ownership for Docs metadata, page
content, and Memory. Keep loading separate from editing and saving.

### Implementation

- Extend the resource model in `src/domain/project-loading.ts` and add focused
  hooks for Docs and Memory. Remove the old parallel loading effects.
- Resource states: `idle`, `loading`, `ready`, `refreshing`, `error`.
  Identify resources by host, project root, group ID, resource type, and page ID.
- Give metadata, document content, and Memory separate cache entries. Bound
  content caches by bytes as well as entry count. Clear them on project removal
  or identity change.
- Make backend revisions authoritative. Publish resource changes after create,
  save, move, reorder, delete, restore, and Memory writes.
- Subscribe across windows. For remote resources, use a revision query or change
  cursor on the existing transport; do not resend whole libraries to detect change.
- Debounce filesystem changes. Reconcile on focus and reconnect as a fallback.
  Suspend background reads while hidden. Share pending reads for the same key.
- Never replace a dirty document with a refresh response. Keep draft recovery,
  serialized saves, and expected-revision checks from the current editor.
- Model save states separately: `clean`, `dirty`, `saving`, `conflict`, `failed`.
  Offer retry, reload, or preserve-as-copy when a conflict occurs.
- Flush or retain recoverable drafts before changing the selected page. A failed
  flush must not silently discard an edit.
- Prevent deleted or moved resources from being restored by a late response.
  Read-only Memory content must reflect truncation and size limits.

### Acceptance and tests

- Concurrent readers share one request. Changes in one window invalidate other
  readers of that resource.
- Tests cover fast project switches, late responses, remote reconnect, deletion,
  trash restore, external edits, stale revisions, cache eviction, and read errors.
- Editor tests prove that refresh and page changes cannot erase unsaved content.
- A failed Memory read does not show another project's entries.

Primary files: `src/components/project-docs.tsx`, `src/components/project-memory.tsx`,
`src/hooks/`, `src/domain/project-loading.ts`, `electron/storage/project-docs.ts`,
`electron/storage/project-memory.ts`, `electron/remote-agent.ts`.

## 5. Remote reconnection after a connection drops

### Required behavior

Reconnect dropped hosts in the background. Local navigation and library reads
must never wait for reconnection. Respect explicit disconnect and shutdown.

### Implementation

- Add a connection state machine: `disconnected → connecting → connected`;
  a retryable failure moves to `retry-wait → connecting`; a terminal failure moves
  to `error`. Record attempt count, next retry time, error category, and generation.
- Keep startup autoconnect. Use one queue with at most three concurrent connection
  attempts across startup, automatic retry, and manual reconnect.
- Use exponential backoff with injected jitter. Proposed delays: 1, 2, 4, 8, 16,
  then at most 30 seconds. Stop after eight attempts and expose Retry.
- Reset the attempt budget after a stable connection, not merely a successful
  handshake. Proposed stability period: 60 seconds.
- Retry transient transport loss and timeouts. Stop on authentication rejection,
  host-key failure, missing installation, or protocol mismatch. Unknown failures
  receive a bounded retry policy and an actionable error.
- Inject clock, scheduler, randomness, and transport for deterministic tests.
  Reject callbacks from an old connection generation.
- Cancel queued attempts and timers on explicit disconnect, host removal, or app
  shutdown. Keep explicit disconnect for the current app session; startup
  autoconnect still applies on the next app launch.
- Reconnect manually without creating a second pending attempt. Account for
  sleep/resume without starting a burst of missed retries.
- On reconnect, refresh host capabilities and invalidate remote resource caches.
  Start one session reconciliation scan in the background.
- Do not replay commands, file writes, chat submissions, or approvals. The current
  SSH agent may terminate with its transport. Mark interrupted runs explicitly;
  only offer resume after the new agent confirms the provider session exists.
- Show connection and retry state in the host picker. Keep cached data clearly
  identified as stale until reconciliation succeeds.

### Acceptance and tests

- Simulate transport loss, half-open connections, sleep/resume, and unreachable
  hosts with a fake scheduler. Tests must not sleep.
- Verify concurrency limits, retry delays, attempt limits, reset after stability,
  manual reconnect, cancellation, and old-process events.
- A remote failure does not delay a local library response.
- No mutation or answer is sent twice after a reconnect.

Primary files: `electron/remote-hosts.ts`, `electron/remote-snapshot-cache.ts`,
`src/domain/host.ts`, `src/api/contracts.ts`, `src/components/remote-host-picker.tsx`,
`tests/remote-hosts-backend.test.ts`, `tests/remote-snapshot-cache.test.ts`.

## 6. GitHub Projects feature and API coverage

### Required behavior

Make Kalkidan a complete execution workspace for GitHub Projects V2. GitHub owns
projects, views, fields, issues, pull requests, and task status. Kalkidan connects
that work to Docs, Memory, repositories, agents, and worktrees.

Support every applicable public Projects operation exposed by the connected
GitHub host. Use GraphQL and REST together. Do not restrict the implementation to
the current board/status interface. Do not create a local project board or require
a second provider to complete this work.

The API review below uses official documentation checked on 2026-10-20. Features
vary by host version, account permissions, and owner type. Public documentation
is evidence of an API operation, not proof that a particular token can invoke it.

### API inventory and capability contract

- Add a checked-in capability inventory, proposed as
  `docs/github-projects-capabilities.md`, and a typed capability module under
  `electron/trackers/`. Each row must identify the operation, API field or endpoint,
  owner types, supported host versions, scopes/permissions, pagination, rate cost,
  UI entry point, test, and implementation status.
- Use statuses `implemented`, `planned`, `read-only`, `permission-required`, and
  `not-exposed-by-api`. Record the reason and source for each limitation. An
  unimplemented public operation must remain a tracked gap.
- Cover the Projects queries, objects, mutations, and REST operation families.
  Pin the schema/OpenAPI version used to generate contracts. Provide a schema
  comparison that reports additions, removals, and deprecations for review.
  Run deterministic tests against the pinned schema; do not fetch it during tests.
- Probe capabilities with read-only requests. Never test permissions by creating
  or deleting user data. Model endpoint availability and user authorization
  separately. A permission error must not permanently disable a host capability.
- Support GitHub.com and explicitly tested GitHub Enterprise Server versions.
  Key auth, capabilities, caches, and node IDs by host and account. Explain version
  gaps and provide a link to the relevant GitHub page.
- Preserve unknown field variants in read results. Do not drop entire items when
  GitHub adds a field type. Render unsupported values read-only until supported.

### Functional coverage

| Area                   | Implementation scope                                                                                                                                                                                                         | API reference                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Project administration | Discover user and organization projects; create, copy, edit, close/reopen, delete, and manage templates. Include descriptions, README, visibility, linked repositories/teams, and collaborators where authorized.            | [GraphQL Projects](https://docs.github.com/en/graphql/reference/projects), [REST Projects](https://docs.github.com/en/rest/projects/projects) |
| Item lifecycle         | Add issues/PRs, create/edit drafts, convert drafts to issues, archive/unarchive, remove items, and change project order. Keep item removal separate from deleting its issue. Include archived and restricted-content states. | [REST items](https://docs.github.com/en/rest/projects/items), [GraphQL Projects](https://docs.github.com/en/graphql/reference/projects)       |
| Fields and values      | Discover every field and value type. Create/edit/delete supported custom fields; set/clear text, number, date, single-select, multi-select, and iteration values. Manage supported option and iteration configuration.       | [REST fields](https://docs.github.com/en/rest/projects/fields), [GraphQL Projects](https://docs.github.com/en/graphql/reference/projects)     |
| Saved views            | Read/create/edit/delete views; implement table, board, and roadmap layouts. Round-trip filters and exposed configuration, including visible fields, grouping, and sorting. Persist supported changes to GitHub.              | [REST views](https://docs.github.com/en/rest/projects/views), [GraphQL Projects](https://docs.github.com/en/graphql/reference/projects)       |
| Progress reports       | Read/create/edit/delete project status updates and display status/date information.                                                                                                                                          | [GraphQL Projects](https://docs.github.com/en/graphql/reference/projects)                                                                     |
| Issue hierarchy        | Show parent/sub-issue relationships and progress. Add, remove, and reorder sub-issues through issue endpoints.                                                                                                               | [Sub-issues API](https://docs.github.com/en/rest/issues/sub-issues)                                                                           |
| Dependencies           | Show and edit blocking relationships. Preserve unavailable references and distinguish incomplete data from no blockers.                                                                                                      | [Issue dependencies API](https://docs.github.com/en/rest/issues/issue-dependencies)                                                           |
| Change notifications   | Consume applicable project, item, and status-update events with scope-aware reconciliation.                                                                                                                                  | [Webhook events](https://docs.github.com/en/webhooks/webhook-events-and-payloads)                                                             |

Implement field-definition edits with a read/modify/write operation that preserves
options or iterations the user did not change. Do not equate a display name with
a stable field ID. Remove the hard-coded English `Status` field lookup; let the
user map workflow roles to available field and option IDs. Recognize renamed,
removed, localized, and duplicated labels without guessing the intended field.

Assignees, labels, milestone, and repository are issue/PR properties, not ordinary
custom item-field writes. Route changes through the corresponding content APIs.
Keep issue state, PR state, and project status distinct. The API guide documents
this ownership boundary. [Using the Projects API](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects)

Extend the task inspector with issue/PR details, comments, assignees, labels,
milestones, issue types, reviewers, reviews, linked PRs, checks, and merge status
where the host exposes them. Provide editing or actions through the appropriate
Issues/Pull Requests APIs with explicit permissions. A project write permission
does not imply repository write permission. [Issues API](https://docs.github.com/en/rest/issues),
[Pull Requests API](https://docs.github.com/en/rest/pulls)

### Views, planning, and operation boundaries

- Replace the current fixed status columns with views generated from field and
  layout definitions. Support column visibility, filtering, sorting, grouping,
  multi-selection, and bulk edits where the public API permits persistence.
- Keep local display preferences distinct from shared GitHub view configuration.
  Label an unsaved view. Do not claim a view was saved when only local storage
  changed. Preserve unsupported GitHub filter expressions instead of rewriting
  them into an approximate local filter.
- Implement iteration planning, date-based roadmaps, workload summaries, and
  priority/estimate editing from actual field definitions. Show missing data.
- Inventory workflow reads and documented mutations, including deletion. Do not
  infer workflow creation/editing support from the presence of a workflow object.
  Use an Open in GitHub action for controls without a documented public write API.
  Keep GitHub's built-in automation distinct from Kalkidan session automation.
  [Built-in automation](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations)
- Show current distribution and workload from available project data. For cycle
  time, throughput, and historical trends, specify the history source and retention
  window. Never invent history from a current snapshot. Label locally derived
  analytics; do not present them as synchronized GitHub Insights charts. Inventory
  Insights APIs before promising chart editing. [Project Insights](https://docs.github.com/en/issues/planning-and-tracking-with-projects/viewing-insights-from-your-project/about-insights-for-projects)
- Keep pagination complete for items, fields, field values, views, collaborators,
  and related issue connections. Do not call a partially fetched project complete.
- Track project-item ID, content node ID, REST ID, issue number, project number,
  owner, and host separately. Use typed identifiers at service boundaries.
- GitHub batch operations are not assumed atomic. Report each result and allow
  retry of confirmed failures. Reconcile uncertain outcomes before retrying.
- Present a concrete preview for destructive or broad changes. Never let a bulk
  status change silently close underlying issues or merge pull requests.

### Creative workflows built on GitHub

These are proposed Kalkidan experiences, not claims that GitHub supplies them as
single API operations. Each workflow must use the inventory and shared services.

1. **Plan to execution.** Select a Docs section and propose an issue breakdown,
   acceptance criteria, dependencies, and project fields. Review the exact writes,
   then create GitHub issues/sub-issues and add them to the project. Attach a Docs
   reference only when requested; keep private Memory out of published text.
2. **Ready for an agent.** Offer a saved view of unblocked, sufficiently specified
   tasks with repository and checkout information. Explain missing prerequisites.
   Starting work creates the selected worktree/session and links it to the GitHub
   item. Recheck the item before launch; assignment is not an exclusive lock.
3. **Parallel work planning.** Group independent issues by repository and blocker
   graph. Propose bounded agent concurrency and one checkout per task. Detect
   active sessions for the same issue and warn about overlapping work. Keep
   scheduling metadata local; keep task state in GitHub.
4. **Evidence-based completion.** Show the issue, branch, PR, review state, checks,
   and relevant tests together. Agent completion can suggest Ready for review.
   Move to Done only under the configured rule, such as verified PR merge. Do not
   treat a successful agent process exit as evidence that the issue is complete.
5. **Iteration planning assistant.** Propose an iteration allocation using priority,
   estimate, dependencies, and stated capacity. Show the reasoning and missing
   estimates. Let the user apply selected field changes in one reviewed batch.
6. **Project health report.** Draft a status update from verified blockers, overdue
   dates, stale items, and completed work. Include source links and the reporting
   window. Publish only on an explicit user action or a configured automation rule.
7. **Release readiness view.** Combine milestone/iteration membership, unresolved
   dependencies, PR checks, and Jenkins build evidence. Link external evidence to
   its source. Do not introduce GitHub Actions as a required CI system.
8. **Triage and reusable project setup.** Propose labels, priority, field values,
   and possible duplicates for new items. Let users copy a GitHub project template
   and map its fields to session workflows. Preserve their custom fields and views.
9. **Portfolio and personal work views.** Combine authorized GitHub projects into
   a read view of assigned work and risks. Keep per-project fields and permissions
   intact; send every edit to its owning GitHub project. Do not build a local board.

### Synchronization, automation, and authentication

- Expand section 3's cache into a shared GitHub Projects service with separately
  cached project metadata, fields, views, item pages, and on-demand content details.
  Avoid fetching every issue body and comment just to paint a board.
- Support token renewal, revoked access, SSO requirements, multiple accounts, and
  host-specific permissions. Store credentials outside project data. Explain the
  least permissions needed for the action the user requested.
- Use polling with freshness checks for desktop installations. For an optional
  GitHub App webhook integration, define a reachable receiver, signature checks,
  tenant routing, event deduplication, and delivery recovery. A desktop app is not
  automatically a public webhook receiver. Support polling when an event or owner
  scope is unavailable. Treat event payloads as invalidation hints and reconcile.
- Publish resource change events across open windows. Handle out-of-order events,
  sign-out, deleted fields, archived items, and inaccessible content explicitly.
- Give automation rules a stored version, trigger, conditions, target action, and
  idempotency record. Prevent update loops with GitHub automation and other clients.
  Show the last run, source evidence, result, and retryable failures.
- Keep GitHub mutations centralized. Agent tools request scoped operations through
  the same validation and permission path as the UI. Do not supply broad tokens to
  prompts or accept arbitrary GraphQL from model output.

### Code cutover and tests

- Expand `src/domain/github.ts` and tracker contracts to retain all needed ProjectV2
  types rather than flattening everything into title/body/status. Keep raw unknown
  variants for forward compatibility without enabling unsupported writes.
- Split `electron/github-projects.ts` into focused project, item, field, view,
  issue-relation, auth, and synchronization services. Share transport, account
  resolution, retries, limits, and cache invalidation.
- Remove optional tracker calls and legacy GitHub fallback branches once all
  consumers, IPC handlers, preload methods, remote routes, and fixtures use one
  contract. Do not add a second provider factory or provider-selection product UI.
- Migrate stored links and workflow mappings without changing GitHub IDs or user
  data. Preserve GitHub repository cloning and other repository features.
- Cover each inventory operation with offline fixtures for success, permission
  denial, rate limits, malformed responses, unsupported host versions, and partial
  failure. Test user-owned and organization-owned projects separately.
- Add browser tests for table/board/roadmap, field editors, iteration planning,
  hierarchy, dependencies, status reports, bulk result review, and agent launch.
- Keep live contract smoke tests opt-in, on a disposable GitHub project. Never use
  production boards for destructive tests or live GitHub in the coverage suite.

### Acceptance and delivery slices

| Slice | Deliverable                                                                       | Completion evidence                                                                 |
| ----- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| G1    | API inventory, host/account capabilities, expanded models, shared transport/cache | Every public Projects operation accounted for; permission and version fixtures pass |
| G2    | Project/item lifecycle and full field editors                                     | Supported mutations work through one API path and round-trip to GitHub              |
| G3    | Saved views, roadmap, iterations, issue hierarchy and dependencies                | Shared configuration persists; relations survive refresh and restart                |
| G4    | Status updates, automation, sync, permissions and analytics boundaries            | No update loops; revoked access and event loss recover correctly                    |
| G5    | Agent execution, Docs-to-issues, triage, portfolio and release workflows          | End-to-end tests prove reviewed writes and traceable execution                      |

The feature is complete only when every applicable inventory row is implemented,
or has a verified API/permission/version limitation with an explicit UI behavior.
A limited GitHub status board, a second adapter, or a fake provider test does not
meet this requirement. Keep unsupported API operations visible in the inventory
so later schema updates can remove the limitation.

Primary files: `electron/github-projects.ts`, `electron/github-auth.ts`,
`electron/trackers/`, `electron/preload.ts`, `src/domain/github.ts`,
`src/domain/tracker.ts`, `src/api/contracts.ts`, `src/lib/tracker-client.ts`,
`src/hooks/use-project-board.ts`, `src/components/project-tracker.tsx`,
`src/components/tracker-board.tsx`, `src/components/tracker-workflow.tsx`,
`tests/tracker-provider.spec.ts`, `tests/tracker-workspace.spec.ts`.

## 7. State machines for operations and resource ownership

### Review findings and design rules

This review inspected `src/app.tsx`, the project, repository, conversation,
browser, onboarding, and terminal components, plus the authentication, agent,
repository, and PTY services in `electron/`.

Some explicit states already exist. Extend `ProjectLoadCache`, `GitHubAuth`,
`ChatRun`, and the remote connection model. Do not replace working transitions
merely to use a new library. The main gaps are operations whose progress is split
between booleans, refs, promises, and side effects in different owners.

Use a small typed reducer or transition function for each operation. Use
discriminated unions so invalid combinations cannot be represented. Add a state
machine library only if nested or concurrent behavior requires it and a concrete
implementation demonstrates the benefit. Do not create one global machine for
the entire application.

- Define state, event, guards, transition, effect, and cleanup for each machine.
  Keep transition functions pure. Inject clocks, IDs, scheduling, and transports
  into effect owners.
- Electron or the remote agent owns operations that change external state.
  Renderers observe operation snapshots and send commands. Closing a dialog is
  not proof that its backend operation stopped.
- Give each operation an ID, generation, project/host identity, and typed result.
  Match completion events to all relevant identity fields before applying them.
- Use structured error kinds such as `permission`, `conflict`, `transport`,
  `validation`, and `unknown-outcome`. Do not infer state transitions from UI text.
- Distinguish an idle operation from success with an empty result. Distinguish
  cancel requested from cancel confirmed.
- Derive `busy`, action availability, progress labels, and errors from state.
  Keep drafts, selections, and display preferences outside operation machines.
- Separate concurrent concerns. Document loading and saving, connection and
  installation, and agent execution and pending questions must not share one
  status field.
- Retain operation results until acknowledged or evicted by a bounded policy.
  Persist only recovery metadata needed for durable effects. On restart, inspect
  actual external state before deciding whether an interrupted operation succeeded.
- Retries must resume the failed step when possible. Never repeat an acknowledged
  commit, project creation, issue creation, or agent submission to retry its next
  step. Unknown outcomes require reconciliation first.
- Emit versioned operation snapshots across IPC. Events can prompt a fresh read;
  renderers must be able to recover after missing an event.

### S1. Workspace route and library loading — medium priority

Evidence: `src/app.tsx` uses `home`, `sessionsPage`, `boardGroup`, `projectPage`,
`selected`, and open chat state to choose content. Library refresh has a request
sequence guard. `use-navigation-history.ts` already manages bounded history.

Use one discriminated route value for home, all sessions, project page, repository,
and conversation. Include the required IDs in each route variant. Keep open tabs
and draft state separate. A route reducer should handle navigation, back/forward,
entity removal, and session-ID resolution without resetting unrelated operations.
Reuse the existing history mechanism rather than adding a second history store.

Use the resource machine for library loading:
`idle → loading → ready`, with `refreshing` and `error` outcomes. Remote scans
remain background operations. A remote error must not move an available local
library back to a blocking initial state.

Test removed-project history entries, session ID changes, rapid navigation,
out-of-order snapshots, and a failed remote refresh while local data is available.

### S2. GitHub authentication and permission checks — high priority

Evidence: `electron/github-auth.ts` already has statuses and generation checks,
but separate dialogs poll and track whether they started authentication.
`inspect()` currently checks `github.com` and returns idle for multiple failure
conditions. Extend this existing machine for section 6.

Backend states: `unknown`, `checking`, `signed-out`, `authorizing`,
`awaiting-user`, `verifying`, `ready`, `permission-required`, `expired`,
`canceled`, and `error`. Treat account/host change as a new generation.
Successful CLI exit moves to `verifying`; permissions determine readiness.

Use one authentication operation per host/account. A dialog owns its subscription,
not the shared login process. Closing one of two observing dialogs must not cancel
the other's login. An explicit Cancel command must identify the current attempt.
Keep network failure, missing CLI, SSO requirements, and insufficient permissions
distinct from signed-out.

Test two observers, code expiry, browser launch failure, token override, account
switch during verification, late process exit, and cancellation before/after code
delivery. Verify that authentication cannot grant an unsupported operation.

### S3. Project creation, repository import, and onboarding — high priority

Evidence: `create-project.tsx` performs create, optional import, snapshot refresh,
then navigation. It already catches import failure after creation. Onboarding has
another create/import sequence. `add-repository.tsx` emits clone progress events;
the clone service preserves partial files when a clone fails.

Define one reusable backend operation:
`validating → preparing-root → creating-project → adding-repositories →
reconciling → completed`. Terminal alternatives are `partially-completed`,
`failed`, and `canceled`; transport ambiguity enters `unknown-outcome`.
Optional steps must have explicit skip transitions.

Record the created group ID immediately. A failed refresh must offer Open/Refresh
for that group, not submit Create again. Track each requested repository and its
result. Retry only failed imports. For cloning, distinguish reserving a directory,
cloning, validating the checkout, and registering it. Preserve the reserved path
and explain recovery; never delete a directory with unverified ownership.

Capture host, root, and project identity when the operation starts. Keep the
operation alive if its dialog closes. Add a backend status query for reopening
progress. Onboarding should compose these operations and derive readiness from
the selected host, repository, and agent. Keep optional GitHub setup skippable.

Test creation followed by failed import/refresh, clone completion followed by
failed registration, repeated submissions, dialog closure, host changes, restart
recovery, and mixed import results. Verify that retry does not create duplicate
projects or overwrite partial downloads.

### S4. Agent execution and conversation presentation — high priority

Evidence: `conversation.tsx` combines `loading`, `starting`, `startingRef`, run
state, polling, reconnect state, and stop calls. The backend runtime already owns
processes and session locks. Keep it authoritative.

Execution states: `preparing → starting → running → stopping → stopped`, with
`completed`, `failed`, and `interrupted` terminal outcomes. Keep a separate
transport observation state so a failed poll does not imply the agent failed.
Transcript loading uses the resource machine. Section 2's question/approval
machines are children of a run and do not replace its execution state.

Stop during startup must record intent and stop the process when its ID becomes
available. Duplicate start/stop events must be idempotent. Once terminal, a late
poll cannot return a run to running. Preserve the submitted draft until acceptance
is known. An unknown send result requires lookup by operation ID before resubmission.

Specify tab lifecycle behavior explicitly: closing a view and stopping work are
separate commands. Release session locks and pending requests exactly once.
Reconnect may restore observation of a known run or report interruption; it must
not silently start the prompt again.

Test stop-before-start-response, duplicate completion, approval during stopping,
transport loss after submission, tab remount, process exit during a question, and
two windows attempting to write to the same session.

### S5. GitHub task execution and status automation — high priority

Evidence: `project-tracker.tsx` creates a worktree before starting a task;
`conversation.tsx` updates task lifecycle information; `src/lib/task-status.ts`
reads the board and performs a status change. These steps cross services.

Use an execution operation:
`validating-task → selecting-checkout → preparing-worktree → launching-agent →
active → collecting-evidence → ready-for-review → completed`.
Model blocked, launch-failed, interrupted, and awaiting-decision outcomes.
The operation's phase is not itself the GitHub item's status.

Use a separate synchronization state:
`clean → pending-write → writing → confirmed | failed | unknown-outcome`.
A configured rule may request a GitHub transition from verified evidence.
If the agent starts but a status write fails, keep the active run and retry the
status write. If worktree creation succeeds but launch fails, reuse that worktree
on retry. External edits must be reconciled before applying the rule again.

Test duplicate triggers, renamed/deleted options, launch failure after checkout
creation, status failure after launch, external status changes, and concurrent
GitHub automation. A failed sync must not launch a second agent or mark work Done.

### S6. Commit, branch, pull-request, and worktree operations — high priority

Evidence: `session-menu.tsx`'s `submit()` stores a commit in a local `next` result,
then requests a PR, and publishes the result only after both calls succeed. A PR
failure therefore needs an explicit partial-success result. Repository dialogs in
`app.tsx` also share general mutation flags.

Commit/PR states: `inspecting → ready → committing → committed →
publishing-branch → creating-pr → completed`. Skip the commit step when no commit
is requested. Expose `commit-failed`, `publish-failed`, `pr-failed`, and
`unknown-outcome` with the last confirmed commit SHA, branch, and PR URL.
Observe which steps the backend currently combines and return structured results
at the actual boundaries.

Retry PR creation without repeating the commit. Check for an existing PR before
retrying an uncertain create result. GitHub `clientMutationId` must not be assumed
to provide server-side deduplication. Snapshot selected files and repository
identity at submit time and revalidate before executing.

Give worktree creation/removal its own compact machine: `checking → creating` or
`checking → awaiting-dirty-decision → removing`, followed by `completed` or
`failed`. Keep an active agent checkout protected. Do not treat a dirty-check
failure as permission to force removal.

Test commit success plus push/PR failure, stale file selection, existing PR
reconciliation, branch conflict, dirty worktree confirmation, active-session
removal rejection, and repository navigation during an operation.

### S7. Docs, Memory, and cached resources — high priority

Use the existing resource states from sections 1, 3, and 4. The resource owner must
track key, generation, revision, and pending request, rather than let each component
maintain its own loading flags. Keep empty data distinct from a missing response.

For Docs saving, extend section 4's save machine with explicit handling of edits
made during `saving`. A save success cleans only the version submitted; a newer
draft remains dirty. `conflict` and `failed` retain the newest recoverable draft.
Delete/restore/reorder operations have separate IDs and cannot be mistaken for
save completions. Autosave timers belong to the editor operation, not the cache.

Memory extraction follows section 1's queue states. Storage writes have their own
revision outcome. A background extraction result must not overwrite a newer
external memory edit or declare success before the atomic write finishes.

Test save/edit interleavings, cache invalidation during a read, deletion during
save, external memory changes, view closure, and failed draft persistence.

### S8. Remote setup, installation, connection, and reconciliation — high priority

Extend section 5 instead of adding another connection machine. The current picker
also tracks setup through a busy label and `check/install/connect` step.

Use a setup child operation:
`checking-prerequisites → install-required → installing → verifying-install →
ready`, with `failed` and `canceled`. Connection attempts must not run against a
bundle being replaced. Installation success means the verified version is ready;
it does not by itself mean the host is connected.

On reconnect, use a bounded reconciliation operation:
`pending → scanning → synchronized | partial | failed`.
Keep retry scheduling independent of this scan so connection health cannot be
misreported as failure merely because one resource scan failed.

Test install/connect overlap, failed version verification, disconnect during
install, queued retry after explicit stop, and partial session/resource recovery.

### S9. Terminal process lifecycle — medium priority

Evidence: `interactive-terminal.tsx` uses generation, exit/error state, and a
terminal ID; `electron/pty-terminal.ts` waits for readiness and tracks exit.

Use `opening → ready → closing → closed`, with `failed` and `interrupted`.
Restart creates a new generation. Read, write, resize, and close commands carry
the terminal ID and generation. Late startup completion must close an orphan
terminal if its owner was disposed. Closing must settle pending startup.

Do not restart a remote command automatically after disconnect. A stale output
poll cannot write into the replacement terminal. Keep visibility/focus outside
this machine.

Test close-before-ready, resize-before-ready policy, failed writes, duplicate
close, helper exit, remote loss, and restart with pending old output.

### S10. Directory browsing and repository scanning — medium priority

Evidence: `folder-picker.tsx` already rejects stale reads through a request counter.
`repository-import.tsx` owns a pending selection resolver after a scan.

Retain these protections in compact states: `closed`, `loading`, `ready`,
`error`; scan/selection uses `scanning → selecting → selected | canceled | failed`.
Identify each request by host, path, and generation. Closing or changing hosts
invalidates requests and settles each selection promise once. A late scan must
not reopen a dismissed picker or replace a newer selection.

Reuse the resource reducer rather than add a separate framework. Test rapid path
changes, permission failure, host switch, close during scan, and repeated choose
operations. Ordinary filter text and hidden-file preference remain simple state.

### S11. Embedded browser and annotations — lower priority

Evidence: `embedded-browser.tsx` combines readiness, browser state polling,
selection, busy/error state, view layout, and unmount cleanup.

Separate view lifecycle (`creating → ready → closing → closed`, with `failed`)
from page loading and annotation (`idle → selecting → selected → attaching →
attached | failed`). Bind selections to browser ID and navigation generation.
Navigation invalidates a selection from the old page. The attach result must refer
to the captured document and viewport, not whichever page is now visible.

Keep layout, find text, device size, and toolbar toggles outside these machines.
Hidden views stop unnecessary polling without discarding valid browser sessions.
Test close during creation, selection during navigation, stale polls, repeated
attachment, and layout updates after disposal.

### S12. Component update tracking — high priority

Status: runtime installation, desktop/helper inventory, running versions, release
feeds, durable history, and recovery are implemented. Real runtime installation
passed on macOS/Linux. Packaged desktop and live account acceptance remain open.
Use the [update tracking contract](verdictan-integration-implementation.md#update-tracking)
for state names, limits, release identity, and recovery behavior.

Track Kalkidan, the managed Verdictan runtime, and SSH helpers by installation,
host, component, channel, OS, and architecture. Record native agent versions and
external ownership for compatibility. Keep installed, running, discovered, and
approved versions separate. Compare release/build IDs and digests, not only
displayed versions. A discovered release cannot supply its own approval pins.

Implement:

- A typed domain contract in `src/domain/updates.ts` and one backend owner under
  `electron/updates/`. Discovery and installation have separate machines.
  Reuse the Verdictan installer and SSH setup effects instead of adding another
  installer or competing state owner.
- Nonblocking startup/reconnect checks, manual refresh, bounded concurrency,
  coalesced reads, freshness, and explicit offline/unknown/unsupported outcomes.
  Keep a failed check distinct from a successful result of no available update.
- A durable journal with operation IDs, generation/sequence guards, byte progress,
  confirmed previous/target/active releases, sanitized failures, and bounded
  history. Coordinate writers across application processes on the execution host.
- Typed IPC, preload, and SSH status/action/event contracts. Reconcile an
  authoritative snapshot after restart, transport loss, or an event gap.
- Settings and host views with version inventory, check times, staged/deferred
  updates, progress, retry, and rollback results. Give desktop download/restart
  guidance and external-agent update guidance.

Do not replace an active runtime. Stage the update and show the active-work
reason for deferral. Revalidate compatibility and revocation before activation.
After activation, inspect the running binary and readiness before marking success.
An uncertain result requires inspection before retry. Recovery never restarts a
user prompt or restores direct-provider routing.

Acceptance requires deterministic transition and effect tests, local/SSH boundary
tests, two-window/process ownership tests, and UI tests. Cover repeated displayed
versions with different build IDs, stale metadata/events, unavailable hosts,
checksum failure, cancellation, active work, interrupted activation, disk failure,
rollback failure, and installed/running mismatch.

### Where a state machine is not needed

Keep simple state for search text, filters, selected rows, theme, sidebar width,
collapsed tree nodes, dialog visibility, and ordinary form drafts. A single
read request can reuse the resource state helper. Pure parsing, validation, and
formatting functions need no lifecycle machine.

Do not build a state-machine wrapper around every API call. Use one only when
there are meaningful transitions, competing events, durable partial effects,
resource cleanup, or recovery obligations.

### Test and implementation contract

For each S1–S12 item:

1. Record its owner, typed states/events, legal transitions, guards, effects, and
   terminal cleanup in the implementation module.
2. Write transition-table tests, then effect tests with controlled promises and
   injected time. Cover duplicate, stale, reordered, and invalid events.
3. Verify invariants across event sequences: terminal states do not regress;
   durable successes are not repeated; unrelated operations do not block each
   other; resources and session locks are released once.
4. Add an integration test at the actual boundary: IPC, remote protocol, storage,
   Git, or browser. Reducer coverage alone is insufficient.
5. Replace the old owner and remove redundant flags/refs. Do not retain two
   competing sources of truth after cutover.
6. Verify that diagnostics include operation IDs and transitions, but omit
   credentials, document bodies, and private prompts.

Implement S2–S8 with their related feature changes. Prioritize S3 and S6 for
partial-success handling. Implement S1, S9, and S10 after the shared contracts
are stable. Implement S12 with the installers and release metadata contracts.
S11 follows the higher-priority correctness work. Extend existing
machines before introducing new abstractions.

## Completion record — 2026-10-21

| Deliverable                                   | Source status              | Verification boundary                                                                                                                       |
| --------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Managed Memory and interactive requests       | Implemented                | Offline and native-provider fixture tests; no claim of live tenant acceptance.                                                              |
| Shared board cache and Docs/Memory loading    | Implemented                | Credential/generation scoping, conflict recovery, leases, and browser tests.                                                                |
| Background remote reconnect                   | Implemented                | Bounded queue, backoff, explicit disconnect, wake probes, generation guards, and no command replay.                                         |
| GitHub administration and public API controls | Implemented for GitHub.com | See `github-projects-api-coverage.md` for each family and verified API limits.                                                              |
| Operation recovery                            | Implemented                | Durable creation/start/task/publish/worktree/batch records, general project mutation history, and explicit user review of uncertain writes. |
| Component updates and runtime installation    | Implemented                | Real public runtime clean install/restart on macOS/Linux; desktop replacement remains manual and needs packaged acceptance.                 |

GitHub write history stores operation names, hashes, timestamps, and outcomes.
It does not store tokens or request bodies. Unresolved records survive restart;
confirmed history is bounded. The same uncertain mutation cannot be dispatched
again until the user inspects GitHub and records that review. Recording a review
does not assert success. Project creation uses its own durable operation owner.

Project workflow behavior and external acceptance boundaries are listed near the top.
The implementation is merged and published as recorded above. No production
GitHub board mutations were used for acceptance checks.

## Verification commands

Use the pinned Node/npm toolchain. Run `npm test`, `npm run test:ui`,
`npm run typecheck`, `npm run lint`, `npm run format:check`,
`npm run check:architecture`, `npm run build`, and `npm run test:desktop`.
The native harness requires the exact binaries documented in
`native-agent-acceptance.md`. Verification is retained as normal development work;
it is not a separate Tests and CI implementation workstream.
