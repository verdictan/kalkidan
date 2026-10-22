# Compatibility and support window

This document gives the Verdictan versions, the protocol versions, and the agent versions that
Kalkidan supports. It also gives the deprecation dates and the contract source of truth.

Status: **approved** on 2026-10-22. The product owner decided the window and the notice period.

## Source of truth

Verdictan `cli/docs/contracts/` is the one source of truth for the shared contracts.
`desktop-support-window.v1.json` in that directory is the machine-readable support window.

Kalkidan keeps a byte copy in `contracts/verdictan/`. Do not edit the copy.
`contracts/verdictan/source.json` gives the Verdictan commit and the SHA-256 digest of each file.
`src/domain/compatibility.ts` holds the same values for the code. A test makes sure that they agree.

To change the window:

1. Change the Verdictan file and `cli/docs/kalkidan-support-window.md` in a Verdictan PR.
2. After the merge, run `npm run sync:verdictan-contracts -- <path to the Verdictan checkout>`.
3. Change `src/domain/compatibility.ts` to the same values.
4. Run `npm test`. `tests/verdictan-contracts.test.ts` fails until all three agree.

The current copy comes from the Verdictan PR branch. Sync it again from `main` after that PR merges.

## Support window

Policy: Kalkidan supports the current Verdictan release and the two releases before it.
Before Kalkidan stops support for a version, it gives 90 days of notice.

| Item                                             | Value                                                  |
| ------------------------------------------------ | ------------------------------------------------------ |
| Supported Verdictan runtime versions             | `0.6.10`, `0.6.11` (known-broken, see below), `0.6.12` |
| Desktop protocol                                 | Version `1` (min `1`, max `1`)                         |
| Minimum Kalkidan version (Verdictan enforces it) | `0.1.0`                                                |
| Minimum Codex                                    | `0.160.0`                                              |
| Minimum Claude Code                              | `2.1.300`                                              |
| Runtime hosts                                    | macOS arm64 26.7.1 or later, Linux x64                 |

Kalkidan installs the newest signed Verdictan release. It does not pin a version.
An SSH host can run an older runtime until it updates. The window applies to each host.
A release newer than `0.6.12` is supported. The window moves when Verdictan publishes it.

## Deprecation schedule

| Component         | Versions                    | Deprecated                       | End of support | Replacement       |
| ----------------- | --------------------------- | -------------------------------- | -------------- | ----------------- |
| Verdictan runtime | Each version before `0.6.8` | 2026-10-22                       | 2027-01-20     | `0.6.12` or later |
| Verdictan runtime | `0.6.8`                     | 2026-10-22 (release of `0.6.11`) | 2027-01-20     | `0.6.12` or later |
| Verdictan runtime | `0.6.9`                     | 2026-10-22 (release of `0.6.12`) | 2027-01-20     | `0.6.12` or later |
| Desktop protocol  | `1`                         | Not planned                      | Not planned    | —                 |

Until 2027-01-20, Kalkidan runs each version before `0.6.10` and shows a warning. On that date, it refuses them.

Versions older than `0.6.6` have no `setup.bootstrap`, so they cannot run the one-time Kalkidan
setup. Kalkidan does not refuse them before 2027-01-20. When the setup cannot finish, Settings ›
Agents shows: "This Verdictan runtime cannot finish the Kalkidan setup. The setup needs runtime
0.6.6 or later. Update the runtime in Settings › Computers, then open this window again."
An organization that finished the setup earlier can still run agents with these versions.

## Known-broken releases

`runtime.known_broken` in the window file lists releases with a defect that stops a component.

| Release  | Component        | Problem                                                                           | Fixed in |
| -------- | ---------------- | --------------------------------------------------------------------------------- | -------- |
| `0.6.11` | Managed gateways | `verdictan gateway supervise` stops at startup ("Internal error: builder error"). | `0.6.12` |

- Kalkidan never installs a known-broken release. `discoverRuntime` skips it, also when it is the
  latest GitHub release, and finds the newest release before it. The installer refuses it too.
- A computer that has a known-broken release keeps its account. Diagnostics shows "Known problem".
- Kalkidan does not move that computer back to an older release. It installs the fixed release
  automatically when Verdictan publishes it. Until then, Settings › Computers says that Kalkidan
  waits for the fixed release.

## Enforcement

| Check                                                                | Where                                                                              | Result                                                                                          |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Runtime older than the window after its end of support               | `assertRuntimeSupported` in `electron/verdictan/account.ts`, at each account check | `desktop.runtime_version_unsupported`. Managed agents stop.                                     |
| Runtime without `setup.bootstrap` or a usable `setup.ensure_default` | `electron/verdictan/setup.ts`                                                      | Settings › Agents says that the setup needs runtime 0.6.6 or later. The runtime is not refused. |
| The same checks before activation of a downloaded runtime            | Install probe in `electron/verdictan/service.ts`                                   | Kalkidan does not activate the release.                                                         |
| Protocol range without version 1                                     | `parseCapabilities`                                                                | `desktop.protocol_unsupported`                                                                  |
| Agent below its minimum                                              | `src/domain/agent-version.ts`, at each launch                                      | `desktop.codex_version_unsupported` or `desktop.claude_code_version_unsupported`                |
| Kalkidan below the minimum desktop version                           | Verdictan API and release manifest                                                 | Verdictan refuses the session.                                                                  |

The message for an unsupported runtime is:
"Kalkidan does not support this Verdictan runtime version. Update the runtime to 0.6.10 or later in Settings › Computers."
Diagnostics in the account menu shows the version of each runtime and its status: Supported, Deprecated, or Not supported.

## Contract checks in CI

`tests/verdictan-contracts.test.ts` runs in `npm test`, which Jenkins runs through `scripts/ci.sh`. It makes sure that:

- each copied file has the digest in `source.json`;
- the support window agrees with its schema and with `src/domain/compatibility.ts`;
- each fixture of each protocol version in the window agrees with its schema;
- for each runtime version in the window (`0.6.10`, `0.6.11`, `0.6.12`), the contract files have the
  digest of that release, and Kalkidan reads and accepts the `capabilities` event of that release.
  `0.6.10` and `0.6.11` use the snapshots in `contracts/verdictan/releases/`, because the
  contracts changed after them;
- Kalkidan reads the `capabilities` events of the deprecated releases and marks them deprecated;
- each deprecation gives at least 90 days of notice;
- the requests that `DesktopProtocol` writes agree with the request schema;
- an unsupported runtime and an unsupported protocol get their codes.

Verdictan runs the same fixture checks in `cli/packaging/desktop-support-window.test.mjs`.
That test also makes sure that the window is the newest release and the two releases before it.
