# Implement Verdictan authentication and required agent routing

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

## Delivery scope

The active work covers native agents on macOS/Linux, GitHub project administration
and API coverage, recovery/state machines, and updates/installation. Windows
isolation and the separate Tests and CI workstream are excluded at the user’s
request on 2026-10-21. Existing launch safeguards and verification remain.

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

## Current Kalkidan implementation — 2026-10-21

Managed launch is wired for local and SSH execution. Account authentication,
project/host bindings, runtime provisioning, protected credential export, fresh
readiness, gateway ownership, inference retry guards, and OS containment precede
native execution. Logout and revocation stop owned gateways. Missing containment
blocks launch. User data remains readable while signed out.

Codex `0.163.0-alpha.10.2` and Claude Code `2.1.304` passed 28 native conversation
cases and four containment cases across macOS and Linux. These cases use synthetic
provider responses. The application-level live gateway/account journey is a
separate acceptance boundary.

### Updates and installation

- Public Verdictan v0.3.0 artifacts come from `verdictan/packages`. The old private
  repository URLs were corrected. Version, archive size, SHA-256, platform, minimum
  OS, protocol, and reviewed metadata checks run before activation. No release
  signature is required.
- Real macOS ARM64 and Linux x64 clean installations, owner restarts, and desktop
  protocol capability probes passed through the production installer.
- Runtime discovery reads up to five release pages. A public feed does not approve
  new artifacts. Reviewed pins remain the installation authority and expire after
  seven days. Releasing refreshed approvals remains an application release task.
- Runtime installation has a private operation journal, a cross-process lease,
  staging, busy guards, cancellation, activation validation, and rollback.
- Desktop inventory records running/installed build identity, available downloads,
  SHA-256, check time, and stale/error state. Desktop replacement is an explicit
  download/install/restart action.
- SSH helper setup records previous and target digests, validates the handshake,
  blocks updates during active work, and retains bounded rollback history.
- Component refreshes use one generation so late results cannot replace newer
  inventory. Externally installed Codex and Claude remain externally managed.

### Evidence and external acceptance

The current unit suite has 320 passing tests, and all 96 browser tests pass.
Type checks, lint, formatting, build, architecture checks, and the Electron smoke
test pass. Jenkins validation and release packaging also passed. Native fixture evidence is described in `native-agent-acceptance.md`.
Live policy/billing/account acceptance and packaged desktop upgrade acceptance
have not been run. Do not report those journeys as passed.

The Verdictan service remains owned by its separate repository. This change does
not claim to have implemented or deployed that service. The requirements below
remain the integration contract; historical implementation notes were replaced
with this current record.

## Required behavior

- Users can sign in or create a Verdictan account from Kalkidan.
- Sign-up and registration are the same account-creation flow.
- Kalkidan installs the Verdictan CLI as an application dependency.
- Each SSH host that runs agents also receives a compatible CLI installation.
- Every model request from an agent managed by Kalkidan must use that CLI gateway.
- Agent execution stops or stays blocked when this route is unavailable.
- There is no direct-provider fallback or user setting that disables this route.

This replaces the earlier proposal for optional Verdictan connections.
Existing repositories, documents, and history remain readable while signed out.
Starting or continuing an agent requires authentication and a ready gateway.

## Immediate cutover

The integration release makes Verdictan authentication and routing mandatory
immediately for all users of that release. There is no pilot, cohort rollout,
opt-in period, grace period, or legacy direct-provider mode.

Complete validation before release. Prepare the API, Console, CLI artifacts, and
contracts before activating the desktop release. This dependency order is not a
gradual user rollout.

On first launch after upgrade, stop any legacy managed agent processes before
accepting new agent work. Preserve conversation state and drafts. Require account
setup, CLI installation, and gateway readiness before starting or resuming agents.
Users who cannot complete setup can still read and export existing local work.
Recovery or rollback must retain mandatory routing or keep agent execution blocked.

Do not claim that the new release can control an older binary that a user has
not upgraded. Document the minimum supported desktop version and the update
requirement. Test rejection of unsupported clients at Verdictan-controlled APIs.

## Scope and enforcement boundary

The initial agents are Codex and Claude Code. Cover new sessions, resumed sessions,
forks, retries, model discovery, background model calls, and agent-created subagents.
Future runtime adapters must meet the same routing contract before registration.

"All requests" means model traffic from Kalkidan-managed agents. Git, SSH,
account authentication, gateway control-plane traffic, and package downloads need
their own connections. Shell commands, MCP tools, and browser requests are not
automatically governed by a model gateway.

An endpoint setting alone cannot guarantee that an arbitrary child process will
not call a provider directly. Inventory every model request path and test it.
Where an agent can bypass its endpoint configuration, add process-tree egress
controls on the execution host or block that agent mode. Do not claim complete
enforcement based only on environment variables. State platform limits explicitly.
Do not intercept unrelated applications on the user's computer.

## Source findings

Inspected on 2026-10-20:

- `electron/interactive-chat.ts` launches native agents with pipes and an explicit
  environment. Keep each agent's native conversation protocol.
- `electron/agents/runtime.ts` registers runtimes for desktop and SSH execution.
- `electron/remote-agent.ts` owns operations on remote execution hosts.
- `electron/config/runtime.ts` validates native executable overrides.
- `src/api/contracts.ts`, `electron/preload.ts`, and `electron/main.ts` define the
  typed desktop boundary.
- Verdictan source is at `/Users/dennisotugo/Work/verdictan/work`.
- Verdictan has `cli/src/commands/auth-login.ts`, `cli/src/auth/login.ts`, and
  `cli/src/commands/auth-session.ts`.
- `auth-login.ts` rejects browser login when stdin is not a terminal. The platform
  now provides `auth desktop` for automation. Consume that contract; do not
  simulate a terminal or add a duplicate authentication flow.
- `console/src/app/register/page.tsx` and `console/src/app/auth/cli/page.tsx`
  provide existing registration and CLI authentication entry points.
- `console/src/lib/auth/cli-handoff.ts` validates a loopback callback and S256.
  Reuse and audit the complete flow before extending it.
- `api/src/domains/oauth/` contains existing OAuth implementation code.
- `cli/src/gateway/runtime-capabilities.ts` defines request-family, modality,
  transport, and feature capabilities. Extend this contract.
- `cli/src/gateway/request-pipeline/response-event-headers.ts` produces policy
  decision headers. These headers alone do not establish desktop observability.
- The CLI package guide says release executables contain Node.js. Validate that
  property in packaged artifacts rather than requiring users to install Node.js.

These findings identify integration points. They do not establish that current
authentication, gateway protocols, or subscription credentials satisfy this plan.

Public documentation checked on the same date:

- [Usage costs and budgets](https://verdictan.com/docs/usage-costs-and-budgets/)
  describes provider billing with user-supplied credentials and estimated usage.
  Different budget surfaces enforce different request paths.
- [Resolve an escalation](https://verdictan.com/docs/resolve-an-escalation/)
  says resolution updates the review record. It does not replay a request or
  change the policy.
- [OAuth for native apps](https://www.rfc-editor.org/info/rfc8252/) supports
  authorization through the system browser. Keep this boundary when making
  sign-in feel consistent across both products.

Treat these as current constraints to test against the shipped versions.

## Architecture

```text
Kalkidan renderer
    -> typed IPC -> desktop authentication and gateway services
                       -> system browser -> Verdictan account flow
                       -> managed Verdictan CLI on execution host
                              -> Verdictan control plane
                              -> model provider

Kalkidan-managed coding agent on execution host
    -> authenticated loopback CLI gateway -> model provider
```

For SSH projects, the coding agent and gateway run on the SSH host. Desktop
authentication stays on the user's computer. Provision a separate restricted
runtime credential for the remote host. Never copy browser sessions, refresh
credentials, or organization administrator tokens to that host.

## 1. Install and manage the CLI dependency

Implement `electron/verdictan/install.ts` and a shared host-side installer module.
Use a pinned release manifest supplied by Verdictan. The manifest must identify
version, protocol version, platform, architecture, artifact URL, SHA-256 digest,
size limit, and required runtime dependencies.

1. Determine the execution host's operating system and architecture.
2. Select a supported artifact from the approved release manifest.
3. Download it over HTTPS.
4. Verify its size and SHA-256 digest against the pinned release metadata.
5. Extract it safely into a staging directory under an application-owned path.
6. Verify the binary version and required capabilities.
7. Atomically activate the installation.
8. Start the gateway and check readiness.

Use a per-user installation with no administrator requirement. Proposed paths:

- Desktop: an application data directory under `~/.kalkidan/runtime/verdictan/`.
- SSH host: a user-owned `~/.kalkidan/runtime/verdictan/` directory.

Use versioned directories and an explicit executable path. Do not depend on PATH,
Homebrew, a globally installed CLI, or the user running an installation command.
Treat optional reuse of an existing binary as a verified compatibility decision.

Prefer bundled, verified artifacts in desktop installers so first launch can
install without a second download. Supply a verified download path for remote
hosts and updates. A supported artifact must be available for every advertised
desktop platform and SSH platform. Unsupported systems block agent startup.

Handle concurrent installation attempts with a lock. Reject archive traversal,
unexpected symlinks, checksum mismatches, and incompatible versions. Preserve the
last working version on failure. Do not replace binaries used by active gateways.
Switch versions after controlled shutdown. Clean up unused versions later.
Use a compatible installed copy when downloads are unavailable. Never fall back
to direct provider access.

Expose installation progress, retry, version, and failure details in Settings.
Do not download or execute an unverified `curl | sh` installer from the app.
Packaging must include notices and the required runtime files. Confirm that
each shipped artifact meets the documented self-contained release contract.
Do not assume Node.js is installed.

Bundle reviewed release metadata with Kalkidan instead of trusting a downloaded
manifest to choose its own version, digest, or download origin. Define metadata
expiry, replay rejection, revoked releases, and the minimum safe version. A rollback
cannot select a revoked or incompatible release. Kalkidan owns updates of its managed
copy; the CLI self-updater must not replace that copy independently.

### Update tracking

Status: component tracking and runtime/helper installation are implemented. Live and packaged desktop acceptance remain open. The Verdictan runtime
has a durable installer journal and Settings view. Extend tracking to Kalkidan
releases and the SSH helper. Record native agent versions for compatibility
checks. An agent installed outside Kalkidan remains externally managed.

Keep three values separate: the version installed on disk, the version running in
an owned process, and the newest compatible release approved for installation.
Also show a newer discovered release when it is not yet approved. A discovery feed
cannot replace the reviewed version, digest, or origin pins required above.

Use one backend update service with these contracts:

- Identify a component by installation ID, host ID, component, channel, OS, and
  architecture. Distinguish release ID/build revision from version text so two
  main-branch builds with the same displayed version are not treated as identical.
  Verify the artifact digest. Do not order releases by string comparison.
- Discover desktop releases from the existing Jenkins publication metadata and
  runtime releases from approved Verdictan metadata. Define the feed schemas and
  origins before implementation. Keep stable/prerelease channels explicit.
- Check on app open and host reconnect without blocking usable projects. Coalesce
  requests from all windows. Default to six-hour freshness, a 30-second check
  timeout, and three concurrent host checks. Make these limits configurable.
  A manual Check for updates action bypasses freshness, not an active request.
- Keep `lastAttemptAt`, `lastSuccessAt`, source revision, compatibility result, and
  sanitized error details. Retain the last result on network failure and mark it
  stale. Offline, unknown, unsupported, and up-to-date are distinct outcomes.
- Track an update operation with an ID, host/component identity, generation,
  previous and target release IDs, expected digest, phase, byte progress,
  timestamps, failure code, and confirmed active release. Persist transitions
  atomically. Exclude credentials, prompts, and private project content.
- Use a single writer per host/component across application processes. The
  execution host owns installation state. Desktop caches are observations.
  Events carry operation ID, generation, and sequence; reconcile a snapshot after
  a gap or reconnect. Ignore stale events from a replaced operation.

Discovery states:
`unknown → checking → current | available | blocked | failed`.
An old successful result may remain visible during `checking` or `failed`, with
its age. A stale result does not establish that no update exists.

Installation states:
`requested → downloading → verifying → staged → waiting-for-idle → activating →
validating → completed`.
Also support `canceled`, `failed`, `interrupted`, `unknown-outcome`, and
`rolling-back → rolled-back | rollback-failed`. Model cancellation only at phases
where the installer can safely cancel. A completed download is not an installed
or running release.

Bind each active run to its runtime release. A staged update waits for the owning
processes to stop. Show why it is waiting and require an explicit action before
interrupting work. Recheck revocation and compatibility before activation.
Confirm the executable identity, capabilities, and gateway readiness afterward.
If validation fails, restore a compatible, nonrevoked previous release or leave
execution blocked. Never replay a user prompt as part of recovery.

On restart or SSH loss, read the durable journal and inspect the actual active
release before retrying. A lost activation response is `unknown-outcome`, not
permission to activate twice. Bound history to 100 terminal records and 1 MiB per
host/component. Preserve the active operation and latest recovery checkpoint;
compact optional history before starting new work.

In Settings and host details, show installed, running, discovered, and approved
versions; freshness; progress; and the last result. Offer Check for updates,
Install approved update, Retry, and supported rollback actions. Show desktop
download/restart guidance and externally managed agent update guidance. This
tracking work does not require an automatic desktop installer.

Test discovery with unchanged metadata, a repeated version with a new build ID,
channel changes, unsupported targets, expired metadata, rate limits, and offline
hosts. Test concurrent windows/processes, stale events, active-run deferral,
checksum failure, cancellation, disk failure, crash during activation, reconnect,
rollback failure, and installed/running version mismatch. Use injected time and
offline feeds. Verify progress through local IPC and SSH, not only demo fixtures.

## 2. Authenticate with the Verdictan account

Add Sign in and Create account actions. Both open the system browser on an
approved regional Verdictan origin. Registration must preserve the pending
desktop authorization through email verification, MFA, SSO, and organization
selection when those steps apply.

Reuse the CLI browser flow with a supported non-TTY interface. Require PKCE S256,
unpredictable state, an expiring one-use code, loopback callback validation, and
bounded callback lifetime. Never put a password or reusable token in a URL.
Kalkidan is a public desktop client and cannot keep a client secret.

Define one credential owner. Prefer the managed CLI profile backed by secure
platform storage, with Kalkidan receiving only sanitized status. If secure
storage requires a desktop broker, keep token transfer on a protected local
channel. Do not return secrets over renderer IPC, logs, or normal JSON events.
Do not fall back silently to plaintext storage.

Support cancel, timeout, restart, expired session, renewal, revocation, sign-out,
and region changes. Serialize concurrent renewal. On sign-out, stop managed
agents and gateways, revoke supported credentials, and remove local secrets.
If remote revocation cannot complete, show that state and keep local launches
blocked. Do not claim that an unreachable remote process has stopped.

Signing in to Verdictan does not itself grant model-provider access. Setup must
resolve a provider connection and allowed models. Do not assume a consumer
coding-agent subscription can be used through a gateway.

## 3. Provision a gateway for each execution host

Implement a gateway supervisor with states:

`missing -> installing -> signed-out -> provisioning -> starting -> ready`

Also expose `expired`, `blocked`, `stopping`, and `failed` with stable reason codes.
Installation and authentication can have independent internal state.

Provision resources idempotently for account, organization, installation, and
execution host. Separate account credentials, runtime credentials, and model
request credentials. The API must authorize each resource and scope.
Do not require broad administrator access for ordinary desktop users; report
organization policy restrictions as actionable errors.

Bind to loopback on a free port. Require authenticated model requests. Verify
gateway identity and protocol version, not just that something answers on a port.
Readiness requires valid credentials, active policy, and an allowed provider/model.
Keep stdout machine-readable and stderr sanitized. Bound restart attempts.
Stop agents when the gateway fails. Do not replay a partial streamed request
automatically. Preserve the conversation so the user can retry explicitly.

On SSH disconnect, a host-side supervisor must enforce gateway lifetime and
credential expiry independently of the desktop connection. Reconnect must
reconcile existing processes rather than start duplicates.

## 4. Route every supported agent

Create an agent-specific gateway configuration adapter behind `AgentRuntime`.
The adapter produces validated arguments and a controlled child environment.
Use per-run or application-owned configuration. Preserve user CLI settings.

Audit configuration precedence, inherited provider credentials, native login
fallback, resume metadata, custom endpoints, and child-process inheritance.
Remove or override every supported direct-provider route for managed runs.
Keep necessary OS variables and executable resolution intact.

Validate the exact installed versions of Codex and Claude Code against gateway
request families. Test streaming, cancellation, tool calls/results, reasoning
fields, attachments, context compaction, retries, and subagents. Publish a
compatibility matrix. Disable unsupported modes with a clear explanation.

Fetch allowed models through the gateway. Reject stale or unauthorized model
choices before launch and enforce them again at the gateway. Attach supported
project, task, session, agent, and host correlation identifiers. The server must
derive organization authority from credentials, not trust caller metadata.

## 5. Add the desktop API and UI

Proposed files:

- `src/domain/verdictan.ts`: serializable account, installation, and gateway state.
- `electron/verdictan/`: authentication, provisioning, installation, supervisor,
  credential access, and configuration adapters.
- `src/api/contracts.ts`: explicit status, install, sign-in, registration,
  cancel, sign-out, and retry methods.
- `electron/preload.ts` and `electron/main.ts`: validated method implementations.
- `electron/remote-agent.ts` and remote operation contracts: scoped host actions.
- Settings and onboarding components: account and dependency setup.
- Update contracts and service: component inventory, discovery, status snapshots,
  progress subscriptions, installation actions, and bounded history. Include the
  execution-host implementation and Settings/host views.

Do not expose arbitrary commands, environment values, or generic RPC to React.
Keep the browser preview honest: show unavailable native capabilities.

Show account, organization, region, CLI version, execution host, gateway state,
and an actionable error. Disable Send until readiness succeeds. Never label a
session as governed before its request path has been verified.

## 6. Acceptance criteria

- A new user registers, verifies their account, and returns to Kalkidan.
- An existing user signs in without entering a password in the desktop app.
- Invalid state, replayed code, expired code, wrong region, and canceled login fail.
- Tokens do not appear in renderer state, process arguments, logs, or transcripts.
- A clean supported desktop installs the CLI without a manual prerequisite.
- A clean supported SSH host installs its own compatible CLI.
- Unsigned artifacts with matching pinned metadata can install successfully.
- Interrupted download, checksum mismatch, port collision, and concurrent setup
  fail safely or recover without direct-provider fallback.
- Codex and Claude each complete a tool-using conversation through the gateway.
- New, resumed, forked, background, and subagent requests follow the same route.
- Test fixtures capture all model destinations. Assert that managed agents cannot
  reach a direct-provider test endpoint even when inherited settings request it.
- Gateway death, expired credentials, denied policy, and revoked access prevent
  further requests. No hidden direct retry occurs.
- Logout and app shutdown handle both local and remote process ownership.
- Gateway records correlate with the correct user, project, session, and host.
- Repeat start, stop, reconnect, and installation operations do not leak processes.

Use temporary directories, fake control-plane/provider servers, and deterministic
CLI fixtures for routine tests. Run real-agent acceptance tests separately using
dedicated test credentials and bounded usage. Record exact tested versions.

Run relevant unit, UI, and Electron tests, then `npm run build`,
`npm run check:architecture`, `npm run lint`, and formatting checks.
Do not run paid provider tests without configured test credentials and scope.

## 7. Make both products behave as one connected service

The following requirements are part of the initial integration. They close gaps
between a working connection and a usable product.

### Define ownership and shared identifiers

| Information                                | Authority                            | Kalkidan behavior                                                |
| ------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------- |
| Account, organization, roles, region       | Verdictan API                        | Display authorized state and refresh it after changes.           |
| Policies, review decisions, allowed models | Verdictan API and gateway            | Display current state; enforce at the gateway.                   |
| Project files, tasks, native sessions      | Kalkidan and existing adapters       | Keep their existing ownership and local storage.                 |
| Credential lifecycle                       | Managed CLI or secure desktop broker | Keep one owner and expose sanitized status only.                 |
| Usage estimates and decision records       | Verdictan                            | Display freshness and correlation IDs.                           |
| Actual provider charges                    | Model provider                       | Identify the billing source; do not label estimates as invoices. |

Use stable opaque identifiers for installation, host, project, conversation, turn,
request, request attempt, and escalation. Display names and absolute repository
paths are not identifiers. Namespace local IDs to prevent cross-device collisions.
Separate a native coding runtime from a Verdictan agent registration in the UI.

Freeze account, organization, region, host, and provider connection for a running
conversation. Record the policy version used for each request; policy changes
must still apply according to server rules. Account switching must not reroute an
existing conversation, reuse another organization's cache, or change its payer.
An explicit transfer creates a new authorized conversation with a preview of the
context to transfer. If transfer is not supported, keep the original read-only.

### Make first use and migration predictable

Use a resumable setup sequence: account, organization, provider access, automatic
installation, readiness, and first request. Returning users skip completed steps.
Keep drafts through verification, browser return, restart, and recoverable errors.
Support invited members as well as organization owners. Do not create duplicate
personal organizations when the user is accepting an invitation.
Provide verification resend, expired-flow restart, and account recovery through
the existing account service. If browser launch fails, offer the same safe
authorization URL for manual opening. Preserve the PKCE transaction and timeout.
Do not ask the user to paste reusable tokens.

The initial provider-access path is BYOK, using an authorized personal or team
provider connection. Explain who pays before the first model call. Do not promise
that an existing coding-agent subscription pays for API requests. Any future
Verdictan-funded access or trial credit is a separate product and billing change.

Show platform fees, if any, separately from model usage. Use the account's actual
entitlements; do not invent free access. Readiness checks should avoid billable
generation. Label an optional model test and its bounded usage before sending it.

At the first launch after upgrade, explain mandatory routing, compatibility,
provider access, capture settings, and the effect on active conversations.
Apply the cutover immediately through a controlled stop and restart. Keep existing history
readable and exportable. Do not run legacy sessions directly to ease migration.
Check resume compatibility after agent, model, or provider changes. If tool state
or context cannot be preserved, offer an explicit new conversation with reviewed
context. Do not silently rewrite the original session.

### Make policy results actionable

Distinguish allowed, blocked, redacted, waiting for review, review resolved,
expired, canceled, and failed states. Preserve unsent drafts and partial output.
Do not promise recovery of output already blocked by policy.

Verdictan review decisions and native tool permissions are different controls.
One must not automatically approve the other. Display the policy reason and
policy version when authorized, plus the request or escalation ID.

The first release links to the relevant Console review and refreshes its status.
It must not show automatic continuation after approval. Offer an explicit retry
only when permitted, and evaluate it again against the current policy. If a
future release resumes a held request, add a separately tested continuation
contract bound to request identity, content, user, expiry, and policy version.

Use validated, region-aware links to exact Console records. A return to Kalkidan
may select a project or conversation; it must never run a prompt or command.
Recheck account and resource access when a link opens. URLs carry no tokens,
prompts, or local paths. A missing desktop installation needs a useful web page.

### Explain cost, limits, and recovery

Use a shared error contract with code, category, retryability, optional retry
time, correlation ID, and a safe user action. Examples of actions:

| Condition                   | User action                                               |
| --------------------------- | --------------------------------------------------------- |
| Authentication expired      | Sign in again and preserve the draft.                     |
| Provider connection missing | Add a connection or contact the team administrator.       |
| Permission or policy denied | Read the reason or open the authorized review.            |
| Budget depleted             | Show the applicable limit and authorized management link. |
| Rate limit                  | Show a bounded wait and allow cancellation.               |
| CLI missing or damaged      | Repair the verified installation.                         |
| Version unsupported         | Explain which component needs an update.                  |
| Service or host unavailable | Show the affected component and a safe retry.             |

Select and verify the budget mechanism on the actual request path. Show estimate
freshness, currency, and missing pricing explicitly. Never display unknown usage
as zero. Aggregate multiple gateways and subagents in the authorized scope.
Handle concurrent budget reservations, settlement, release, and interrupted
requests without duplicating usage records. A repeated billable provider attempt
may still incur a charge; internal deduplication cannot remove that charge.

Coordinate retries between agent, gateway, and API. Respect retry timing and bound
the total attempts. Do not retry a policy denial, tool side effect, or partial
stream automatically. Track request attempts separately from the user's turn.

### Define data capture and user control

Before the first request, explain the path for source code, prompts, attachments,
responses, audit metadata, and diagnostics. State what stays on the execution
host, what reaches the provider, and what Verdictan stores in the selected region.
Do not imply provider processing uses that same region without verification.

Use minimal metadata by default. Full prompt, response, and repository capture
requires a disclosed user or organization setting. Show when an administrator
controls that setting. Keep optional product analytics separate from required
operational records. Never send raw content in product analytics.

Define retention, local disk limits, export, and deletion for each store.
Explain the effect of account deletion, organization removal, and uninstall on
local transcripts and server records. Clear account-scoped caches and secrets on
switch or logout. Preserve local work according to the user's explicit choice.
Record required audit-retention exceptions rather than promise universal deletion.
Provide device and host revocation from Console. Define a maximum revocation delay.
Use a resource ownership map for uninstall, host removal, and account deletion.
Remove only resources owned by that installation. Shared team connections and
policies must survive. Reinstall must reconcile recoverable state and require
fresh authorization where credentials were removed.

### Handle network and platform conditions

Test sleep and wake, network changes, clock skew, SSH interruption, corporate
proxies, trusted enterprise certificates, headless Linux, and unavailable keyrings.
Never solve a proxy or certificate error by disabling TLS verification.
Use an authenticated SSH transfer of verified artifacts when a supported remote
host cannot download them directly. Verify the pinned SHA-256 digest on that host.
Give a specific supported remedy when secure credential storage is unavailable.

Define separate outcomes for provider, control-plane, gateway, and event-upload
outages. Mandatory routing remains in force. If a policy allows bounded cached
authorization, document its lifetime and revocation delay. Otherwise block the
next request. Never queue user prompts for silent execution when a network returns.

Specify event-buffer capacity, disk limit, expiry, and behavior when full.
Mandatory audit failure must follow explicit organization policy. Optional
analytics failure must not stop coding. Mark delayed or missing evidence honestly.

Package and test the CLI inside the desktop distribution. Test unsigned packages
and document platform installation prompts.
Test a downloaded installer on a clean computer, not only a development build.

## 8. Maintain compatibility and operational support

Provide an authenticated CLI event channel to Kalkidan that does not depend on
the coding agent forwarding gateway headers. Include policy decisions, review
state, request attempts, usage settlement, credential expiry, and gateway health.
Bind subscriptions to the authorized run and session. Use existing gateway
decision and event authorities, not human log parsing. Native turn completion,
provider completion, usage settlement, and audit delivery are distinct states.

Negotiate capabilities between Kalkidan, CLI, API, and the agent adapter.
Define minimum protocol versions, a published support window, and deprecation
dates. Support additive fields and reject missing required capabilities clearly.
Never run a newer endpoint configuration against an untested agent silently.

Publish contract schemas and fixtures that both repositories validate in CI.
Cover current releases and every version within the declared support window.
Version stored state and test rollback compatibility. Roll out server support
before dependent CLI and desktop releases. Optional features may be disabled
individually; rollback must not restore direct-provider routing.

For structured events, define ordering, sequence IDs, replay cursors, duplicate
handling, gaps, backpressure, terminal states, and reconnection. Reconcile with an
authoritative snapshot after a gap. Event replay must never replay model requests.
Use runtime leases or generation identifiers to prevent an old supervisor from
controlling a replacement process on the same host. Reconcile stale registrations.

Provide one diagnostics view that reports component versions, connection state,
and correlation IDs. Offer a redacted support bundle for preview and explicit
export. Do not upload it automatically. Define support ownership across desktop,
CLI, API, provider, and account failures so users do not need to diagnose ownership.

Use keyboard-accessible setup and error flows, screen-reader status announcements,
plain language, localization-ready strings, and status indicators beyond color.
Use consistent names in Kalkidan, Console, and documentation.

Before release, agree on measurable targets for setup completion, time to the first
successful request, local gateway overhead, stream responsiveness, recovery time,
crash rate, and support incidents. Measure gateway overhead separately from model
latency. Use synthetic tests and minimized telemetry under the capture settings.
Assign an owner to each target and a release decision when it fails. Validate
the targets before release, then monitor them from immediate cutover onward.
No pilot or limited release is required. No numeric performance claim is
established by this plan.

## 9. Additional acceptance journeys

- Policy and usage events reach Kalkidan even when the native agent discards
  gateway headers. Duplicate or reordered events do not duplicate UI entries.
- A non-administrator accepts a team invitation and completes a first request.
- A user without provider access gets an explanation before submitting paid work.
- A browser signed in to a different account cannot attach the wrong identity.
- Switching organizations during a stream does not move context or usage.
- A policy escalation links to the correct record and resolution does not replay.
- A missing model price or delayed usage record does not appear as free usage.
- Sleep, proxy change, SSH reconnect, and process restart preserve a recoverable
  conversation without duplicate requests or duplicate resource provisioning.
- Contract-version mismatch gives a repair path before an agent starts.
- Keyboard and screen-reader users can complete setup and recover from failure.
- Export and deletion behavior matches the disclosed policy for every data store.
- A previous-version desktop interoperates within the declared support window.
- Shared-host concurrent sessions cannot stop or read another user's runtime.
- Device revocation, uninstall, and reinstall affect only owned resources.
- An incompatible model or agent upgrade cannot corrupt a resumed session.
- The first upgraded launch blocks all legacy direct execution immediately.
  Neither failed setup nor rollback restores it.

## 10. Later integration opportunities

After the initial release meets its acceptance and operational targets:

- Show authorized per-task usage and policy history inside Kalkidan.
- Add in-app review actions only with correct reviewer identity and permissions.
- Explore Context Fabric for verified work reuse. Keep it opt-in and bind retrieval
  to organization, repository, branch, and commit. Show provenance, freshness,
  invalidation, and deletion. Treat retrieved text as data, not instructions.
- Add administrator-managed installation and policy templates if teams need them.

These are follow-on features. Do not make shared context, automatic transcript
upload, or a second administration UI a prerequisite for the initial integration.

## Delivery record

Kalkidan implements dependency installation, account setup, credential lifecycle,
gateway supervision, local/SSH managed launch, component update tracking, and
recovery ownership. Immediate cutover is the implemented behavior. Setup failure
cannot fall back to direct native execution.

Publication is complete. The remaining end-to-end acceptance checks require a
real account and execution environment:
application-level local/SSH gateway journeys, policy/billing assertions, and
packaged desktop upgrade acceptance. The current native harness and real runtime
installer checks are recorded separately. A mode that cannot meet the enforced
launch boundary stays blocked.

## Companion work

The Verdictan platform source and integration contracts are maintained separately
in `/Users/dennisotugo/Work/verdictan/work`.
