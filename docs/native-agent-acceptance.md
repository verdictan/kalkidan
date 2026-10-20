# Native agent acceptance

## Scope

The opt-in harness runs the real Codex and Claude Code binaries through Kalkidan's
`InteractiveChatRunner`, OS isolation, and inference retry guard. A local HTTP
fixture speaks each provider's streaming protocol. It does not send paid requests.
Each case uses a temporary project and private agent home.

This proves native adapter behavior and the tested isolation rules. It does not
prove account provisioning, real Verdictan gateway authority, SSH reverse RPC,
or live policy and billing behavior. Those journeys remain open. Real runtime
clean-install/restart probes are recorded separately below.

## Run

Use the Node version in `.node-version`. Install dependencies with `npm ci`.
Set absolute paths to the pinned native agents:

```sh
KALKIDAN_CODEX_PATH=/absolute/path/to/codex \
KALKIDAN_CLAUDE_PATH=/absolute/path/to/claude \
node scripts/native-acceptance.mjs
```

The harness requires Codex `0.163.0-alpha.10.2` and Claude Code `2.1.304`.
It writes results and executable SHA-256 values to
`ci-results/native-<platform>-<architecture>/evidence.json`.
Any failed case makes the command fail. Process output is not archived.

The standalone Jenkins definition is `ci/Jenkinsfile.native-acceptance`.
Select `macos` or `ubuntu-vm` and provide the executable paths.
It uses the pinned Node toolchain and archives the evidence. The definition is
prepared in this working tree; it has not been installed as a Jenkins job.
Windows isolation is excluded from the current implementation scope. Managed
Windows launches remain blocked.

## Recorded checks on 2026-10-20

| Host                                         | Native cases                                                                                      | Containment                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Local macOS ARM64, 26.7.1                    | Both agents passed completion, tool use, cancel, provider error, partial stream, resume, and fork | Gateway port allowed; other port, private file, descendant access, and project writes in read-only mode denied |
| Linux x64 over key-based SSH, kernel 6.12.0  | Both pinned agents passed the same seven cases                                                    | Same checks passed; Unix sockets denied in native descendants                                                  |
| Jenkins `windows-vm`, Windows 11 build 26300 | Exact Codex version and a native MXC command verified                                             | Not accepted: current upstream MXC networking permits all host-loopback ports                                  |

There are 28 passing conversation cases and four passing containment cases across
macOS and Linux. Linux tests ran on the SSH host, but they did not exercise the
application's SSH helper and account broker together. Do not label them complete
managed SSH acceptance.

The tests found and corrected three production issues: required macOS preference
service access, nested Codex sandbox failure, and native provider-error replay.
The outer OS boundary now enforces read-only project access when requested.
A per-turn guard prevents additional provider calls after errors or uncertain
transport outcomes. Independent broker tests cover host/account scope, renewal,
logout races, revocation, and reverse-RPC disconnects.

Linux requires `bubblewrap` 0.10 or later, Python 3, and working unprivileged user
namespaces. Missing prerequisites block launch. Windows remains blocked; the app
does not substitute unrestricted execution.

## Runtime installation evidence — 2026-10-21

`tests/acceptance/runtime-install.ts` exercised the production installer against
public v0.3.0 archives from `verdictan/packages`. Clean installation, a new installer
owner after restart, and the real desktop protocol capability probe passed on
macOS ARM64 and Linux x64. Downloads used the bundled SHA-256 approvals and were
installed in disposable roots. This establishes runtime installation, not a
packaged Kalkidan desktop upgrade or live account/gateway acceptance.
