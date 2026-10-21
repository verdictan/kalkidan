# Verdictan–Kalkidan Claude Code subscription contract

Contract revision: 1. Drafted: 2026-10-21.

Status: proposed implementation contract. The checked Verdictan source and
released runtime 0.4.1 do not support this mode. The wire names below are requested
additions. They must be implemented and qualified before Kalkidan enables them.

## 1. Purpose and ownership

Run native Claude Code with the user's existing subscription on the execution
host. Keep mandatory Verdictan policy enforcement, isolation, request history,
and revocation. Do not substitute Anthropic API billing.

Verdictan owns the broker, API, gateway, authorization, usage ledger, runtime
artifacts, and native compatibility evidence. Kalkidan owns the selection UI,
immutable conversation binding, isolated native launch, and SSH transport.
The user requested a Verdictan handoff; this document does not authorize edits
to that repository from Kalkidan's implementation task.

Native login does not prove provider quota or successful managed execution.
The verified Mac login is Claude Max. The Linux host reports first-party OAuth;
its subscription entitlement still needs live verification.

## 2. Discovery and backward compatibility

Retain desktop protocol schema version 1 and its existing envelope and event
rules. Add these values only when the implementation supports them:

| Surface                               | Required value or behavior                                      |
| ------------------------------------- | --------------------------------------------------------------- |
| `capabilities.capabilities`           | `provider_access.claude_subscription`                           |
| `setup.inspect.provider_access_modes` | Include `claude_subscription` when the deployed API supports it |
| Provider                              | `anthropic`                                                     |
| Native agent kind                     | `claude_code`                                                   |
| `tested_agents`                       | Exact qualified Claude executable version                       |
| Omitted access mode                   | Preserve existing BYOK behavior                                 |

Kalkidan requires both capability advertisements. An absent value means
unavailable. It must not trigger a BYOK fallback. Unknown modes must fail
validation. Existing BYOK and `codex_subscription` behavior must retain their
tests and response semantics.

## 3. Provisioning and immutable binding

Continue to use `resources.provision`, followed by `runtime.provision`. Add the
new access-mode value to the existing runtime parameters. This is a structural
example; bracketed values represent existing typed identifiers:

```json
{
  "schema_version": 1,
  "correlation_id": "<request UUID>",
  "operation": "runtime.provision",
  "parameters": {
    "installation_id": "<installation UUID>",
    "host_id": "<host UUID>",
    "session_id": "<session UUID>",
    "agent_id": "<agent UUID>",
    "gateway_id": "<gateway ID>",
    "project_id": "<authorized project ID>",
    "provider": "anthropic",
    "provider_access_mode": "claude_subscription",
    "model": "<authorized native Claude model ID>"
  }
}
```

Keep the current project-ID resolution rules; do not invent a second identifier
namespace. Omit `project_id` only where the existing contract permits it.
Omit `provider_connection_id` or send null. Reject a non-null connection, another
provider, or an incompatible native agent. Reject provider tokens and arbitrary
extra provisioning fields. Return the existing `runtime.provisioned` event.

Persist the access mode with the organization, user, installation, host,
project, session, agent, gateway, policy revision, provider, and model binding.
Include it in idempotency comparisons. Renewal must retain the mode. A resume
must not change mode or provider identity. Require a new authorized session for
such a change.

`runtime.export` must echo `provider_access_mode: "claude_subscription"` in the
existing protected descriptor-3 credential frame. Preserve current generation,
expiry, host ownership, and revocation checks. Never put a Claude bearer or
refresh credential in that frame, the control-plane database, or renderer IPC.

## 4. Native login and gateway authentication

Use the native login on the host that executes Claude Code. On SSH, the remote
CLI must already be signed in. Never transmit the Mac login to an SSH host.

The Verdictan handoff must specify a tested native authentication interface
that also works with Kalkidan's private agent home. Keep refresh credentials in
the native credential store. If a short-lived access-token handoff is required,
document its private, host-local channel, expiry, redaction, and cleanup. Do not
copy the whole native home, unrelated settings, plugins, or session history.
Use a supported native login or renewal path; do not build an undocumented
refresh-token exchange.

Keep two credentials separate:

- Native Claude subscription authentication goes only to the approved Anthropic
  endpoint through the owned gateway.
- Verdictan inference authorization uses the existing `X-Gateway-Key` header.
  The gateway must validate it and remove it before upstream dispatch.

Pin `ANTHROPIC_BASE_URL` to the actual loopback address from `gateway.listening`.
Do not set `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or `apiKeyHelper` for this
mode. These can select gateway/API credentials instead of the subscription.
The native probe must verify that the pinned Claude version can send the
separate gateway header while retaining subscription authentication. Supply
the exact working configuration; do not assume Codex header settings apply.

Bind the verified provider account to the runtime on first use. Do not trust an
unverified client header or decoded-but-unverified token claim as account proof.
Define the provider-supported verification method and a non-secret account
fingerprint. Reject concurrent first-use account changes and later mismatches.
Renewal for the same verified account can continue within current authorization.

## 5. Gateway routing, policy, and isolation

Qualify these candidate native routes before declaring them supported:

| Method | Candidate path                  | Requirement                                                                 |
| ------ | ------------------------------- | --------------------------------------------------------------------------- |
| POST   | `/v1/messages`                  | Streaming and non-streaming messages, tool events, usage, and errors        |
| POST   | `/v1/messages/count_tokens`     | Only if the native version uses it and the subscription endpoint accepts it |
| GET    | Native discovery route, if used | Publish the exact route and prove its authentication and cost behavior      |

The route table is a qualification target, not a claim that subscription login
supports every Anthropic API route. Publish the final allowlist, required
version/beta headers, query handling, limits, and unsupported native features.
Reject routes that are not on the allowlist. Never forward arbitrary URLs.

Allow only explicitly approved HTTPS Anthropic upstreams. Reject redirects,
cross-provider routing, model substitution, API-key fallback, response caching,
and automatic inference replay. Strip Verdictan credentials and internal
correlation headers before upstream dispatch. Preserve native protocol headers
that have passed the compatibility tests.

Evaluate current policy and usage authorization before every inference request,
including requests after tool execution. Keep project, task, run, conversation,
session, and request correlation in Verdictan evidence. A provider identity
check or readiness receipt is not permission to dispatch a model request.

Keep process-tree egress restricted to the owned gateway. Endpoint settings
alone are insufficient. Cancellation, gateway loss, revocation, and account
changes must stop the owned request and native process. Provider errors,
partial streams, and uncertain responses must not cause hidden retries.

## 6. Readiness and state transitions

Preserve the existing readiness envelope and add the new access-mode value.
Use these values in the existing `checks` and `billing` objects (fragment):

```json
{
  "checks": {
    "pricing": "subscription",
    "budget": "provider_quota"
  },
  "billing": {
    "payer": "user_claude_subscription",
    "provider_access_mode": "claude_subscription",
    "provider_connection_id": null,
    "currency": null
  }
}
```

These are additive enum values, not a replacement readiness schema. Return
`dispatch_authorized: false` during readiness. State what each check proves:
runtime binding, native login availability, provider authentication, and quota
are distinct. Do not invent a nonbillable provider probe. If none is supported,
state that provider availability remains unverified until a bounded request.

Cover these transitions without automatic prompt replay:

| Event                                              | Required result                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| Missing or expired native login                    | Stop before inference; request host-local native sign-in                 |
| Provider account changes                           | Invalidate binding; require a new authorized session                     |
| Verdictan account, organization, or region changes | Stop old work; invalidate old credentials and observations               |
| SSH or gateway disconnects                         | Mark outcome uncertain; inspect owned runtime/session before recovery    |
| Revocation or policy denial                        | Stop admission and active work under the existing revocation contract    |
| User retries after an uncertain response           | Require explicit action, fresh authorization, and a new attempt identity |

Reuse existing safe errors where their meaning matches. Add explicit errors for
unsupported Claude subscription access or login requirements where needed.
The release handoff must include a machine-readable error fixture and the
corresponding Kalkidan recovery action. Never include upstream bodies or
credential values in those errors.

## 7. Usage, billing, and history

Add `claude_subscription` to access-mode, credential-origin, billing-category,
and usage-category handling where those fields already exist. Audit database
constraints, codecs, in-memory stores, snapshots, and task-history queries.
Do not leave Codex-only subscription branches in shared reporting.

Record provider-reported tokens, model, timing, decision, policy revision,
request/attempt IDs, and audit references. Keep missing or incomplete usage
unknown. Currency, API price, provider monetary charge, and remaining provider
quota are null unless an authoritative source supplies the applicable value.
Do not present internal zero organization debit as a zero provider charge.
Keep any Verdictan platform fees separate.

Reject unsupported monetary-budget policy requirements explicitly. Never
silently weaken a policy to allow subscription use. Preserve per-task history
through restart and settlement updates, with current account authorization.

## 8. Required acceptance evidence

Use deterministic fixtures before live tests. Record the exact native and
runtime versions, executable hashes, platform, commands, and results. Never
archive bearer values, real prompts, or credential-store contents.

| ID  | Required case                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------- |
| C01 | Old API/runtime does not advertise the mode; Kalkidan stays unavailable                                                           |
| C02 | Valid subscription provision succeeds; wrong provider, connection, mode, and extra secret fields fail                             |
| C03 | Export, renewal, readiness, restart, and revocation preserve mode and ownership                                                   |
| C04 | Real pinned Claude sends subscription authentication and a separate gateway key using synthetic credentials                       |
| C05 | Gateway key never reaches upstream; provider credentials never reach logs, audit, renderer, or another host                       |
| C06 | Native streaming, tool continuation, count-token behavior, cancel, resume, and provider errors match the published route contract |
| C07 | Missing/expired login, quota denial, account switch, policy denial, and control-plane outage do not fall back or replay           |
| C08 | Concurrent first use cannot bind one runtime to two provider accounts                                                             |
| C09 | Direct egress and descendant bypass fail under the managed OS boundary                                                            |
| C10 | Usage/history retain null costs, actual tokens, scoped correlation, and late settlement                                           |
| C11 | Bounded live local macOS subscription request passes through the final published gateway artifact                                 |
| C12 | Bounded live Linux SSH request passes through the helper, desktop account broker, gateway, and remote native login                |
| C13 | Lost SSH response, app restart, and gateway loss recover by inspection without duplicate inference                                |
| C14 | Existing BYOK and Codex subscription regression suites pass                                                                       |

For C11/C12, use a minimal response-only request with tools disabled. Capture
sanitized policy and request receipts. Host-local execution invoked over SSH
alone does not prove Kalkidan's full SSH broker path. Verdictan supplies native
gateway evidence; final cross-application acceptance is joint with Kalkidan.
No Windows isolation or new signing requirement is added by this contract.

## 9. Release and update tracking

Deliver compatible macOS and Linux artifacts for supported architectures,
download URLs, SHA-256 metadata, minimum API/runtime/desktop versions, protocol
fixtures, native configuration, and acceptance evidence. Identify unsupported
architectures explicitly. An implementation commit is not an available runtime.

Maintain this table with evidence links. Use `not started`, `in progress`,
`passed`, or `blocked`; give a reason for every blocked row.

| Area                                       | Initial status | Completion evidence                      |
| ------------------------------------------ | -------------- | ---------------------------------------- |
| Native authentication/header compatibility | not started    | Exact native version and synthetic probe |
| Broker/API schema and storage              | not started    | C01–C03 tests and migrations             |
| Gateway/policy/identity enforcement        | not started    | C04–C09 results                          |
| Usage and per-task history                 | not started    | C10 results                              |
| Published runtime artifacts                | not started    | URLs, hashes, compatibility metadata     |
| Local live acceptance                      | not started    | C11 receipts                             |
| Full SSH acceptance                        | not started    | C12/C13 joint evidence                   |
| Compatibility regression checks            | not started    | C14 results                              |

## References and limits

- [Claude Code authentication](https://code.claude.com/docs/en/authentication)
  documents native subscription login and separate configuration directories.
- [Subscriptions and gateways](https://code.claude.com/docs/en/llm-gateway#subscriptions-and-gateways)
  explains how gateway credentials replace subscription authentication.
- Verdictan's `cli/docs/contracts/codex-subscription-acceptance.md` supplies the
  existing ownership and billing pattern. Its OpenAI routes and account headers
  are not a Claude compatibility specification.

Recheck native compatibility against the final executable. Do not emulate an
unsupported provider login or claim provider endorsement of this integration.
