# Verdictan project services broker contract

Status: implementation alignment in progress. The sibling Verdictan source includes these operations. Kalkidan owns its desktop client and UI. A released runtime must advertise each operation before Kalkidan enables it. Live acceptance remains open.

## Transport and capability discovery

Use the existing `auth desktop` JSON-line protocol, schema version 1. Keep credentials in the broker profile and protected pipe. Do not return account tokens to the renderer. Keep existing correlation IDs, monotonic event sequences, frame limits, and terminal error handling.

Advertise each supported operation in `capabilities.capabilities`. The client must check the exact operation before use. Unknown operations must return `desktop.operation_unsupported`. A missing capability means unavailable, not an empty result or a successful no-op. New operations must not change existing operation semantics.

Each request carries `project_scope`: `{organization_id, project_id}`. `project_id` identifies the immutable GitHub Project node, not its display name. The broker must resolve the current signed-in user and organization. Never trust a renderer-supplied user, role, or permission list. Reject a mismatched organization or inaccessible project.

Operation-specific fields in the table travel at the top level of the protocol request. `project_scope` also stays at the envelope level. Kalkidan uses an internal `fields` object and flattens it at the transport boundary. Operation fields must not override protocol or scope fields.

Every response repeats the verified scope and includes `actor_id`, `revision`, and `observed_at` (UTC). Reads use opaque cursors and at most 100 items per page. All mutations require a UUID `operation_id` and `expected_revision`. The server must bind each operation ID to the actor, scope, operation, and canonical payload hash. Repeated identical requests return the same receipt. A changed payload must fail. Authorization must be checked again on every attempt.

## Operations

| Request operation      | Terminal event                | Request fields in addition to scope                                                    | Result                                                         |
| ---------------------- | ----------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `project.permissions`  | `project.permissions_result`  | None                                                                                   | Current actor and verified permission names                    |
| `task.history`         | `task.history_result`         | `task_id`, optional `cursor`                                                           | Request-scoped usage, policy decisions, and audit references   |
| `review.list`          | `review.list_result`          | Optional `task_id`, `cursor`                                                           | Pending and resolved escalations accessible to this actor      |
| `review.decide`        | `review.decide_result`        | `escalation_id`, `decision` (`approve` or `deny`), `reason`, operation ID and revision | Immutable decision receipt and updated escalation              |
| `context.settings`     | `context.settings_result`     | None                                                                                   | Project opt-in state, retention, and current revision          |
| `context.configure`    | `context.configure_result`    | `enabled`, operation ID and revision                                                   | Updated consent receipt                                        |
| `context.search`       | `context.search_result`       | `query`, `limit` (1–10), `max_characters` (1–8000), optional `task_id`                 | Bounded passages with provenance                               |
| `context.list`         | `context.list_result`         | Optional `cursor`                                                                      | Metadata for knowledge visible to the current actor            |
| `context.publish`      | `context.publish_result`      | `source`, `content`, operation ID and revision                                         | Stored knowledge ID and provenance                             |
| `context.delete`       | `context.delete_result`       | `knowledge_id`, operation ID and revision                                              | Deletion receipt and deletion state                            |
| `admin.templates`      | `admin.templates_result`      | Optional `cursor`                                                                      | Visible installation and policy templates                      |
| `admin.template.save`  | `admin.template.save_result`  | `template`, operation ID and revision                                                  | Immutable template version and audit receipt                   |
| `admin.template.apply` | `admin.template.apply_result` | `template_id`, `template_version`, `installation_id`, operation ID and revision        | Applied version or explicit partial-failure receipt            |
| `operation.inspect`    | `operation.inspect_result`    | `operation_id`                                                                         | `pending`, `completed`, `failed`, or `unknown` and its receipt |

## Result field names

List responses use `items` and an optional `next_cursor`. Context search uses `passages`. History rows include `request_id`, `decision_outcome`, `policy_revision`, `reason_code`, `audit_id`, and `timestamp`. Their nested `usage` object includes `measured_cost`, `currency`, token counts, and `settlement_state`. Preserve decimal strings and null values.

Mutation responses include `operation_id` and `audit_reference`. Review decisions also include `decision_id`, `reviewer_id`, and `request_replayed: false`. Template apply returns installation results and runtime acknowledgments. A pending acknowledgment is not a completed installation. Operation inspection returns `status` and the original nested `receipt`. Kalkidan maps these wire fields to its internal receipt model.

## Authorization and review

Return explicit permissions: `history.read`, `review.read`, `review.decide`, `context.read`, `context.publish`, `context.delete`, `context.configure`, `templates.read`, `templates.manage`, `templates.apply`, and `operations.read`. Operation inspection also requires ownership of the original receipt or an explicit administrator grant. They are scoped to the verified organization and project. UI checks improve feedback; the broker and API must enforce each permission independently.

`review.decide` requires current reviewer permission for the specific escalation, a pending escalation, and the current revision. Enforce separation-of-duty rules on the server. Return `reviewer_id`, `decision_id`, decision time, and an audit reference. A decision must not replay a model request, change policy, or start an agent. A later request needs a new policy evaluation. Concurrent decisions must return a revision conflict; the client must refresh and ask for a new decision.

## Usage and policy history

Bind every row to organization, project, task, run, session, runtime, and request IDs. Include decision outcome, policy revision, reason code, review ID when applicable, audit ID, and timestamps. Usage includes currency, measured cost, token counts, settlement state, and source. Use `null` for unavailable values. Do not replace unavailable usage with zero. Corrections retain their earlier revision and audit trail. Deduplicate by request ID and revision. Do not return raw prompts, provider credentials, or unrelated account usage.

## Context Fabric consent and provenance

Default to disabled for every project. Search and publication require explicit project consent and permission. Disabling consent stops new retrieval and publication immediately. It does not silently delete stored knowledge. Docs retrieval remains explicit-only: project consent must not automatically attach Docs to agent prompts.

Every passage includes `knowledge_id`, source kind and ID, source revision, project scope, author/agent identity, creation time, and deletion state. Do not fabricate provenance for imported text. Treat passages as untrusted reference data, not instructions. Bound the total retrieved text to the requested character budget.

Deletion must remove content from retrieval and invalidate caches. Return `pending` while an index or replica still needs deletion. Retain only the authorized deletion audit record. Deleted or revoked sources must not reappear after reindexing. Export and cross-project publication need separate authorization; project membership alone is not consent.

## Administrator templates

A template has an immutable ID, version, label, allowed host platforms, supported runtime range, installation defaults, and policy references. Do not embed secrets, arbitrary shell commands, or unsigned remote scripts in a template. Validate policy ownership and host compatibility before applying it. Do not weaken mandatory policy through a user override.

An apply operation must return each affected installation and its result. Preserve the old configuration if validation fails. A partial apply must be visible and resumable through the same operation ID. Applying a template must not stop active work without the desktop's existing stop confirmation.

## Recovery and errors

Use safe protocol error codes for unsupported capability, permission denied, scope mismatch, expired session, revision conflict, invalid input, rate limit, and unknown mutation outcome. Do not include tokens or upstream response bodies. After a timeout or transport loss during a mutation, show an uncertain state and query `operation.inspect`. Do not generate a new operation ID or replay an uncertain mutation automatically. Account changes invalidate cached permissions, history, context, templates, and pending UI actions.

## Acceptance and ownership

The Verdictan owner supplies broker implementation, API authorization, idempotency storage, deletion propagation, and a capability-advertising runtime. Kalkidan supplies typed IPC, capability checks, bounded rendering, operation receipts, UI recovery, and contract tests.

Verify these cases before enabling an operation:

- An old runtime shows unavailable and sends no unsupported request.
- A non-reviewer cannot approve through either the UI or direct IPC.
- A stale role, account switch, or cross-project ID fails before data exposure or mutation.
- A lost decision response reconciles to one decision without replay.
- Unknown usage stays unknown, including after restart and settlement updates.
- Context is off by default; explicit-only Docs behavior remains intact.
- Deletion removes cached and indexed passages, with accurate pending status.
- A stale template revision, incompatible host, or partial apply is visible and recoverable.
- Native local and SSH agent requests retain their existing policy enforcement.

No change to the Verdictan repository is included in this handoff.

## Claude Code subscription handoff

Use the dedicated [implementation prompt](verdictan-claude-subscription-prompt.md)
and [technical contract](verdictan-claude-subscription-contract.md) for this work.
The dedicated contract owns the detailed subscription requirements and acceptance tracking.

The user selected the Claude Code CLI subscription for local and SSH execution. Do not replace this choice with Anthropic API billing. As of 2026-10-21, the checked Verdictan source accepts only `byok` and `codex_subscription`. A native Claude login alone cannot satisfy that managed runtime contract.

The Verdictan owner must define and release a Claude subscription access mode before Kalkidan can enable it:

- Proposed wire name: `provider_access_mode: "claude_subscription"`. Advertise `claude_subscription` in `setup.inspect.provider_access_modes` and `provider_access.claude_subscription` in capabilities. Bind it to `claude_code` and `anthropic`; reject a provider connection ID for this mode. Echo the mode in protected runtime credentials and readiness. These names are a requested contract, not an existing capability.
- Specify the native login interface on each host. Keep refresh credentials in the native credential store. Do not copy local credentials to SSH hosts or expose them in IPC, logs, or receipts.
- Preserve native subscription authentication through the owned gateway. Do not set `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or `apiKeyHelper` for this mode. Use a separate gateway authorization header and preserve the native subscription authorization. Define the permitted request routes, headers, streaming, token counting, and login expiry behavior in runtime acceptance fixtures.
- Enforce policy before each inference request. Never fall back to a direct provider route, API billing, or a different access mode.
- Bind runtime credentials and readiness to the selected access mode. Report subscription usage without inventing an API cost.
- Supply local and SSH acceptance evidence for successful execution, expired login, denial, cancellation, and account changes.

Kalkidan must then add capability-gated selection, immutable mode binding, host-local authentication, and acceptance tests against that released contract. The current UI states that this mode is unavailable. No speculative Claude token proxy is implemented.

Claude Code supports subscription login, but gateway credentials replace that login when configured. See [Claude Code authentication](https://code.claude.com/docs/en/authentication) and [subscriptions and gateways](https://code.claude.com/docs/en/llm-gateway#subscriptions-and-gateways).
