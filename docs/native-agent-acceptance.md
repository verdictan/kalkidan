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

## Checks added on 2026-10-21

The production runtime installer now accepts the optional
`KALKIDAN_REDISTRIBUTION.md` notice in the approved v0.4.1 archive. It still rejects
unknown files, links, duplicate entries, and invalid paths. The macOS ARM64
v0.4.1 clean install, restart, and real capability probe passed. Linux retains
its separately reviewed v0.3.0 approval. The v0.4.1 manifest currently approves
only macOS ARM64. Do not copy its pin to another target.

`tests/acceptance/desktop-install-upgrade.mjs` verified published DMGs. It installed
`0.1.0-build.1792500577.fb5e5565bbf6`, created a project and Markdown page, replaced
the app with `0.1.0-build.1792540587.4a1a9a9696ec`, and reopened it. Project color,
page title, and Markdown content survived. A second restart passed. The harness
uses a temporary Applications folder and home directory. It checks the published
checksums before mounting each image. It does not change the user's installed app.

```sh
node tests/acceptance/desktop-install-upgrade.mjs /path/to/old.dmg /path/to/new.dmg
```

Place each release's `SHA256SUMS.txt` beside its installer. The same published
versions passed on Linux x64 (DEB in a disposable container) and Jenkins
`windows-vm` (NSIS in a temporary installation with an isolated profile). Both
preserved project settings and Markdown through the upgrade and restart.
Windows uninstall and cleanup passed. These checks do not test unreleased changes
in the current working tree.

The EU `kalkidan-eu` broker profile was authenticated on 2026-10-21. The deployed
API exposed one team, three policies, and no provider connections. The console
also reported no configured secrets. Live local/SSH agent acceptance remains
open. Subscription access is advertised upstream, but Kalkidan's native adapter
currently supports provider connections only. Native fixture results must not
be reported as live provider acceptance.

The live setup check found typed policy IDs (`cfg_` and `cfgv_`). Kalkidan now
accepts these IDs and legacy UUIDs, while preserving exact selection matching.

## Subscription readiness on 2026-10-21

The user selected Claude Code CLI subscription access. The local CLI reports a
Claude Max login. The Linux SSH host reports a first-party OAuth login. These
status checks do not prove model execution or managed gateway acceptance.

The released Verdictan 0.4.1 capability probe advertises Codex subscription
access, but no Claude subscription mode. The checked broker source also lacks
that mode. The requested contract is in
`verdictan-project-services-contract.md`, under Claude Code subscription handoff.
Do not replace the selected subscription with API billing.

The new managed Codex acceptance harness reached runtime provisioning with one
EU policy. Gateway supervision then reported `desktop.gateway_unavailable`
before a native model request. Local and SSH live acceptance remain open.
