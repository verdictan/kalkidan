# Implementation prompt: Claude Code subscription support

Implement Claude Code CLI subscription access in Verdictan for Kalkidan's managed
local and SSH agents. Work in `/Users/dennisotugo/Work/verdictan/work`. Keep
Kalkidan application changes outside this task.

Read and implement the companion
[Claude subscription contract](verdictan-claude-subscription-contract.md).
Its proposed protocol fields are implementation requirements, not existing API
behavior. If native Claude cannot support a requirement, document the exact
failure and keep the capability disabled. Do not report fixture success as live
acceptance.

## Outcome

Use the Claude Code subscription signed in on the execution host. The user chose
this access method. Do not require an Anthropic API-key connection or substitute
API billing. All managed inference must still pass through the owned Verdictan
gateway, current policy checks, and the request ledger.

The local Mac reports a Claude Max login. Linux SSH host `192.168.1.142` reports a
first-party OAuth login. These are login checks, not live inference evidence.
Use existing host authentication. Do not copy credentials between hosts or put
credentials in code, fixtures, terminal output, or the handoff.

## Starting points

Read the repository contributor instructions. Trace the existing
`codex_subscription` path before changing shared code:

- `cli/src/auth/desktop-runtime.ts` and `cli/src/commands/gateway-supervise.ts`.
- `cli/src/gateway/codex-subscription.ts`, `runtime-pipeline-auth.ts`,
  `server-preflight.ts`, and `desktop-readiness.ts`.
- `api/src/domains/identity_access/desktop-runtime.ts`, `desktop-readiness.ts`,
  `desktop-snapshot.ts`, and `project-services-history.ts`.
- `api/src/domains/gateway/` and `api/src/domains/usage_authorization/`.
- `cli/docs/contracts/codex-subscription-acceptance.md` and its acceptance tools.

Search for every access-mode enum, codec, database constraint, billing branch,
credential parser, snapshot, and audit serializer. Add an explicit Claude mode.
Do not interpret every subscription as OpenAI or copy Codex routes into Claude.
Preserve BYOK and Codex compatibility.

## Implementation order

1. Use the pinned native Claude executable and synthetic credentials to verify
   login selection, custom headers, endpoint routing, streaming, and retries.
   Record the exact version and configuration. Never capture real bearer values.
2. Add `claude_subscription` provisioning, validation, persistence, protected
   export, renewal, readiness, revocation, and capability discovery.
3. Add the Anthropic-specific gateway route and separate gateway authorization.
   Preserve native subscription authentication and prevent direct-provider or
   API-key fallback. Enforce the account and project binding on every turn.
4. Add policy admission, subscription usage accounting, task history, safe
   errors, and recovery. Preserve unknown costs as null.
5. Add deterministic tests and real native gateway fixtures. Run bounded live
   local and SSH acceptance through the managed gateway with existing logins.
6. Produce the runtime artifacts, SHA-256 metadata, request/response fixtures,
   native configuration, and acceptance evidence required by the contract.
   Follow the repository release process. No new signing requirement is added.

## Completion report

Maintain a status table in the contract or a linked evidence file. Give each
requirement an implementation status, test command, result, and remaining issue.
Separate source completion, API deployment, artifact availability, and live
acceptance. State which tested runtime version Kalkidan can enable.

Return the release URL, platform artifacts and hashes, minimum compatible
versions, exact native launch configuration, supported routes, protocol fixtures,
and local/SSH results. Include failures and unsupported platforms. Never claim
completion merely because the source contains the mode or the capability string.
