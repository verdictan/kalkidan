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

## Runtime 0.6.1 approval on 2026-10-21

The operator approved Verdictan 0.6.1 for macOS ARM64 with
`scripts/approve-runtime.ts`. The evidence is the public `v0.6.1` release of
`verdictan/packages` (tag `cli/v0.6.1`, source
`be47270c251be6892f7ab78a9e6c50e1b98c1032`). The approval uses these values:

- Manifest `desktop-release-manifest.v1.json`, SHA-256
  `a005e2b5ed185a0cfaf2558461f737a39a7aaf0825ca42ce307070cf952f994c`.
- Archive `verdictan-aarch64-apple-darwin.tar.gz`, SHA-256
  `93e580d1c3ea8f030e1b73efb278e929ad3e4429aaa67c15284b3baf9ed84311`.
- Executable SHA-256
  `99d6338156cd1c47e0b61f2fd4ed8ce751a99710a3c27bddc80c3d043147c617`.
- Manifest expiry: `1793184758` (2026-10-28 10:52:38 UTC). Renew the approval
  before this time.

`tests/acceptance/runtime-install.ts` installed 0.6.1 from the public release in
a disposable root. Clean install, restart, and the capability probe passed.

The installer now also compares the extracted executable with the manifest
`executable_sha256` value, when the manifest has one.

### Kalkidan-reviewed Linux x64 pin

Linux x64 uses a Kalkidan-reviewed manifest for 0.6.1. Verdictan did not publish
it. The Verdictan desktop manifest lists only macOS ARM64. Verdictan does not
yet list Linux as a qualified managed desktop target. The earlier v0.3.0
Linux pin used the same method.

The operator made the manifest from the public archive and its checksum data.
The operator approved it with `scripts/approve-runtime.ts` for `linux x64 6.12.0`.
The approval uses these values:

- Archive `verdictan-x86_64-unknown-linux-gnu.tar.gz`, size 98317795 bytes,
  SHA-256 `436f5b8f426404fab204dfd7b976cb2d811e6a17403da8c0cd7fa43e9c40d144`.
  The downloaded archive, its `.sha256` asset, and the `sha256.sum` entry agree.
- Executable SHA-256
  `f4784283f864f9f433e2632d023e5b84db0111b8114c32bee38d75187ddb88a5`.
- Reviewed manifest SHA-256
  `8403328eee5e36173af79bc33380687148ec7fdd2f63cadc4cf2297cfccbc5bf`,
  sequence `1792582749000`.
- Minimum Linux kernel 6.12.0. Dependencies: glibc (validated on Enterprise
  Linux 10.2), bubblewrap 0.10.0 or later, and Python 3.
- Manifest expiry: `1793187549` (2026-10-28 11:39:09 UTC). Renew the approval
  before this time.

The production installer completed an offline linux-x64 installation of this
archive on macOS. It checked the archive digest, the archive contents, and the
executable digest. The Linux executable cannot run on macOS, so this check did
not run the capability probe. Run `tests/acceptance/runtime-install.ts` on a
Linux x64 host before you report Linux runtime acceptance.

## Runtime 0.6.3 approval on 2026-10-21

The owner approved Verdictan 0.6.3 for macOS ARM64 and Linux x64. The 0.6.3
pins replace the 0.6.1 pins. The operator used the same method as for 0.6.1.

The evidence is the public `v0.6.3` release of `verdictan/packages` (tag
`cli/v0.6.3`, source `856f06919b1c93d28668ed136fe688cc7ce0d032`). The operator
downloaded the assets with `gh release download` into an empty directory. The
downloaded archives, their `.sha256` assets, and the `sha256.sum` entries agree.
The extracted executables have the digests below.

Offline checks passed for the two executables. Each executable reports version
0.6.3 and both subscription capabilities. Each executable passed the six gateway
startup cases.

### macOS ARM64 pin

The operator approved the published manifest with `scripts/approve-runtime.ts`
for `darwin arm64 26.7.1`. The approval uses these values:

- Manifest `desktop-release-manifest.v1.json`, SHA-256
  `50d3ca1668e4185c14611adc0a69ebcf13f3e04fbc4b766e26470c8d5ffeeb19`,
  sequence `1792589939378`.
- Archive `verdictan-aarch64-apple-darwin.tar.gz`, size 89306873 bytes,
  SHA-256 `8601cbea223e826e8bb4bbe1ed23881f9e6069f77f34d25dc91a1bbc4e421a3c`.
- Executable SHA-256
  `1a929f482c26fdcf3ebf725928cd34ffed1e1c9c1e1a877d53840608c76cef5e`.
- Manifest expiry: `1793194739` (2026-10-28 13:38:59 UTC). Renew the approval
  before this time.

`tests/acceptance/runtime-install.ts` installed 0.6.3 from the public release in
a disposable root. Clean install, restart, and the capability probe passed.

### Kalkidan-reviewed Linux x64 pin

Linux x64 uses a Kalkidan-reviewed manifest for 0.6.3. Verdictan did not publish
it. The Verdictan desktop manifest lists only macOS ARM64. The 0.6.1 Linux pin
used the same method.

The operator made the manifest from the public archive and its checksum data.
The manifest keeps the 0.6.1 Linux values for the protocol range (1 to 1), the
minimum desktop version (0.1.0), the revoked versions (`0.4.0`), the
redistribution notice, and `node_included`. The operator approved it with
`scripts/approve-runtime.ts` for `linux x64 6.12.0`. The approval uses these
values:

- Archive `verdictan-x86_64-unknown-linux-gnu.tar.gz`, size 98320112 bytes,
  SHA-256 `d16e9a77044babfa3fa0549e3fb35f407d559fed4c31994855af409fece0d652`.
- Executable SHA-256
  `270b9341f894bdac0ca7e03483d4cf2ca0c5a87c288214b5af473f56ac4ffe99`.
- Reviewed manifest SHA-256
  `57166785bf7774d7b887841370e253243784b63943c91786befbc8c2b83eac5c`,
  sequence `1792590862000`. This sequence is higher than the 0.6.1 reviewed
  sequence `1792582749000`.
- Minimum Linux kernel 6.12.0. Dependencies: glibc (validated on Enterprise
  Linux 10.2), bubblewrap 0.10.0 or later, and Python 3.
- Manifest expiry: `1793195662` (2026-10-28 13:54:22 UTC). Renew the approval
  before this time.

`tests/acceptance/runtime-install.ts` ran on a Linux x64 host: Red Hat
Enterprise Linux 10.2, kernel 6.12.0, glibc 2.39, bubblewrap 0.10.0, and
Python 3.15. The operator bundled the script with esbuild and ran it with
Node.js 26.11.1, not 24.21.0. The script used an owner-only temporary directory.
It installed 0.6.3 from the public release. Clean install, restart, and the
capability probe passed. The operator then removed the temporary directory.

## Runtime 0.6.4 approval on 2026-10-21

The owner approved Verdictan 0.6.4 for macOS ARM64 and Linux x64. The 0.6.4
pins replace the 0.6.3 pins. The operator used the same method as for 0.6.3.

This approval is urgent. A 0.6.3 gateway does not load the default Kalkidan
configuration that Verdictan makes. Verdictan 0.6.4 corrects this problem. It
also adds the wildcard provider target.

The evidence is the public `v0.6.4` release of `verdictan/packages` (tag
`cli/v0.6.4`, source `0fcac43d0c2e7cfa56e48fd9e46724a1da3d8619`). The operator
downloaded the assets with `gh release download` into an empty directory. The
downloaded manifest and archives, their `.sha256` assets, and the `sha256.sum`
entries agree. The extracted executables have the digests below.

Offline checks passed for the macOS ARM64 executable. It reports version 0.6.4
and both subscription capabilities. It passed the six gateway startup cases.

### macOS ARM64 pin

The operator approved the published manifest with `scripts/approve-runtime.ts`
for `darwin arm64 26.7.1`. The approval uses these values:

- Manifest `desktop-release-manifest.v1.json`, SHA-256
  `f8d59d194c7b4248fdb5ce44e8c3ded80fa6b9b4a3571ebd5d0d7ed8fba59374`,
  sequence `1792593509537`.
- Archive `verdictan-aarch64-apple-darwin.tar.gz`, size 89314460 bytes,
  SHA-256 `06b9a57829b1bafaa65d2ab039d9a3ae0f10145c7c50b007e27f699c1454d76a`.
- Executable SHA-256
  `8c304dea2d503ecc7a1f8d1331db488ee77d995550fd845980802f5a9740d5b6`.
- Manifest expiry: `1793198309` (2026-10-28 14:38:29 UTC). Renew the approval
  before this time.

`tests/acceptance/runtime-install.ts` installed 0.6.4 from the public release in
a disposable root. Clean install, restart, and the capability probe passed.

## Claude subscription adapter on 2026-10-21

Verdictan CLI 0.6.1 advertises `provider_access.claude_subscription`. The Kalkidan
adapter now supports this mode. Kalkidan offers the mode only when the runtime
capability and `setup.inspect.provider_access_modes` both include it. Otherwise
the mode stays unavailable. Kalkidan does not select BYOK as a replacement.

The managed launch uses Claude Code `2.1.304` only. It sends no provider
connection and expects `runtime.provisioned`. The conversation binding keeps the
access mode. A resume cannot change it. The launcher reads the existing native
login on the execution host. On SSH, the remote helper reads the remote login.
The short-lived access token goes only into the owned child environment. The
launcher stops the child before the token expires.

Deterministic tests are in `tests/verdictan-claude-subscription.test.ts`. They
use copies of the published fixtures in `tests/fixtures/verdictan/`. Local and
SSH live acceptance (C11–C13) is still open.
