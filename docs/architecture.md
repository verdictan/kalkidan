# Architecture and extension guide

Kalkidan separates domain data, application services, transport, and presentation. GitHub is the shipped tracker adapter; project management and conversation task context consume a provider-neutral contract. Extensions are trusted, compiled application code. There is no runtime plugin loader or arbitrary downloaded code execution.

## Dependency direction

```text
React components → capability APIs / tracker client → preload IPC
                                                    ↓
                  sender-validated desktop handlers → domain services
                                                    ↓
                           tracker adapters / agent runtimes / native tools
                                                    ↓
                                    GitHub CLI / coding CLIs / Git / SSH
```

- `src/main.tsx` chooses the desktop bridge or honest browser preview and mounts the application.
- `src/app.tsx` composes navigation and project workflows with an injected API.
- `src/domain/` contains serializable tracker, project, conversation, browser, terminal, and host types. It does not import UI or Electron.
- `src/api/contracts.ts` separates `TrackerAPI`, `AgentAPI`, `BrowserAPI`, `TerminalAPI`, `RemoteAPI`, `GitHubAPI`, and `ProjectAPI`. The combined `API` is the desktop bridge. Components with a smaller dependency can accept `Pick<CapabilityAPI, ...>`; `TrackerWorkflow` demonstrates this.
- `src/types.ts` is a compatibility export surface, not a place for new domain implementations.
- `electron/main.ts` remains the composition root and sender-validation boundary. Native operations remain behind explicit IPC methods, never a renderer-controlled generic invoke.

## Add a project tracker

1. Implement `TrackerProvider` in `electron/trackers/`. See the GitHub adapter for the authentication, owner/team, project resolution, board, status, creation, and import contracts.
2. Supply a stable provider ID and capabilities. Normalize provider fields into `TrackerProject`, `TrackerBoard`, and `TrackerItem`. IDs are opaque strings; GitHub owner/number fields are optional.
3. Register the adapter in the `TrackerRegistry` construction in `electron/main.ts`. The default provider appears first in the project picker. Set `KALKIDAN_DEFAULT_TRACKER` to its registered ID when changing the default.
4. Keep vendor URL parsing, authentication, pagination, and error translation inside the adapter. Validate all mutation input at this boundary. Unsupported capabilities must be false; the backend enforces them independently of the UI.
5. Add adapter tests and reuse the integration pattern in `tests/tracker-registry.test.ts` and `tests/tracker-provider.spec.ts`. These exercise a non-GitHub team/project without an owner or project number, persisted connections, capability checks, status mappings, and creation in the real UI.

The picker, board, task status updates, and prompt context use the generic service. Creating a project still requires a tracker connection. Existing unlinked projects remain accessible. Unknown providers produce an explicit unavailable-adapter error; they are never silently treated as GitHub.

`TrackerConnection.statusMapping` stores option IDs for progress and completion. The project's **Workflow** dialog configures them from actual board options. Without an override, the provider descriptor's default status names apply. Marking a task complete still requires the user's action.

Legacy `github` project fields migrate in memory on load and are persisted on the next successful change. GitHub aliases and legacy bridge calls are retained for compatibility. Other providers do not write a GitHub alias.

## Agent and execution extensions

`electron/agents/runtime.ts` defines `AgentRuntime` and explicit runtime registration. Both the Mac and SSH service use `createAgentRuntimes()`. Routing records which adapter owns each run so status, cancellation, approvals, and shutdown return to that adapter. Unknown agents fail explicitly.

Codex and Claude retain their native protocols inside `InteractiveChatRunner`; neither protocol is rewritten as a fake common wire format. To add another coding agent:

1. Add its product metadata to `src/config/agents.ts` (the built-in Agent type is derived from this catalog).
2. Implement and register an `AgentRuntime`; do not send it through the existing Codex/Claude protocol implementation.
3. Implement its model discovery, history discovery, and transcript parsing. The current readers are intentionally specific to the two shipped agents; registration alone does not add history support.
4. Supply process cleanup, approval, cancellation, and session-ownership tests before exposing the agent to users.

`src/domain/host.ts` defines the permitted session operation names and host-qualified session IDs. `src/lib/remote-api.ts` binds a session API to local or SSH execution using typed arguments and results. The desktop service enforces the same remote-method allowlist. Project and tracker metadata stay on the Mac. A future transport must implement the same operation semantics and lifecycle, not expose arbitrary RPC.

## Configuration ownership

| Setting | Location | Meaning |
| --- | --- | --- |
| `KALKIDAN_DEFAULT_TRACKER` | Desktop process environment | Registered tracker ID; default `github`; unknown IDs fail at startup |
| `KALKIDAN_AGENT_REQUEST_TIMEOUT_MS` | Process environment | Native agent request timeout, 1,000–300,000 ms; default 60,000 |
| `KALKIDAN_CODEX_PATH`, `KALKIDAN_CLAUDE_PATH` | Process environment | Optional absolute executable paths; checked for executable access |
| `CODEX_HOME`, `CLAUDE_CONFIG_DIR` | Process environment | Existing native history/config roots |
| Task status mappings | Project Workflow dialog | Actual provider status option IDs |
| UI limits and tool pane defaults | `src/config/interface.ts` | Poll interval, tab/attachment limits, resize defaults |
| Agent names/vendor/short label | `src/config/agents.ts` | Shared product metadata |
| Colors, typography, radius tokens | `src/styles/theme.css` | Design tokens shared by shadcn and feature styles |

Environment overrides apply where the process runs. A remote agent uses its SSH host's environment, not arbitrary environment variables forwarded from the Mac. Changing native configuration requires restarting that process. UI defaults are build-time configuration. Security invariants—sender validation, isolation, SSH host verification, and approval ownership—are not user-disableable feature flags.

## Persistence

`electron/storage/atomic-json.ts` writes a unique temporary file with mode 0600 and renames it atomically. Project groups, session organization, remote hosts, browser profiles, and the repository library share it. Each store owns its schema and serialized write queue. Project and session stores publish their next state after a successful write. This provides atomic file replacement, not transactions across multiple files or processes.

Browser credentials retain Electron safe-storage encryption. Authentication tokens are not stored in tracker connections. A future database implementation belongs behind the store services, preserving their validation and failure behavior.

## Subsystem review and boundaries

| Area | Responsibility and result |
| --- | --- |
| Projects and task boards | Neutral tracker domain, adapter registry, capability-aware UI, workflow configuration, legacy migration |
| Conversations and agent activity | Injected APIs, isolated runtime routing, native approval/session-lock behavior preserved |
| History and transcripts | Separate readers retained; vendor parsing stays outside React; source-specific readers still needed for a new agent |
| Local / SSH execution | Shared typed session operations, explicit host identity, same runtime composition; SSH remains a private stdio service |
| Repository discovery / cloning | Separate `repositories.ts` service; GitHub repository discovery is still a GitHub integration, independent of tracker selection |
| Git / worktrees / diffs | Native Git operations and diff parsing remain separate from tracker adapters; existing checks cover status, worktrees, and new files |
| Terminal | PTY and bounded command services remain separate; renderer terminal controls consume the bridge |
| Embedded browser / annotation | Chromium view, profile store, import parser, and React tools retain separate responsibilities; native isolation preserved |
| Settings and persistence | Shared atomic writer, validated runtime config, installation status matched by agent ID rather than array position |
| Navigation / presentation | Application bootstrap separated from composition; feature components retained; session-to-repository lookup moved to a pure shared helper |
| Styling | Theme, projects, conversation, and tools split into ordered files; no generated gradients introduced |
| Build / tests | Formatting command, boundary check, provider and configuration tests added; browser and desktop regressions retained |

## Checks and deliberate limits

```sh
npm run check:architecture
npm run format:check
npm test
npm run test:ui
npm run test:desktop
npm run build
```

The boundary check guards current static imports between domain, UI, and privileged desktop layers; it is not a complete security analyzer. Prettier keeps compressed components and backend services readable.

GitHub is the only production tracker shipped today. The second provider is a test adapter, not a Linear/Jira integration. GitHub repository discovery/cloning is still vendor-specific. `src/app.tsx`, `conversation.tsx`, and `electron/main.ts` still coordinate substantial workflows; future feature work should extract cohesive services/components at those seams rather than add unrelated state. This architecture enables new adapters but does not promise that every future provider or protocol can be enabled by configuration alone.
