# Network and platform conditions

This page tells how Kalkidan works with sleep, network changes, clock differences, proxies,
enterprise certificates, headless Linux, and computers without a keyring. It also gives the tests
for each condition.

## Release downloads

Kalkidan downloads the Verdictan runtime from `github.com`. Each release has a signed manifest and
a signed archive. Kalkidan verifies the signature and the SHA-256 digest before it installs.

- **This computer.** Kalkidan uses the Chromium network stack of Electron. It uses the proxy
  settings of the system, including PAC files, and the certificate store of the system.
- **SSH host.** The Kalkidan helper uses Node.js. It sets `NODE_USE_ENV_PROXY=1`, so `fetch` uses
  `HTTPS_PROXY`, `HTTP_PROXY`, and `NO_PROXY` from the environment of the SSH session. The tests
  use Node.js 22.23 and 24.21. Older Node.js versions ignore the variable and connect directly.
  The helper trusts the bundled certificate authorities, `NODE_EXTRA_CA_CERTS`, and the system
  store when its Node.js version can add the system store.

Kalkidan never turns off certificate verification. A proxy or certificate problem stops the
download and shows one of these messages:

| Cause                                     | Message starts with                                              |
| ----------------------------------------- | ---------------------------------------------------------------- |
| The server certificate is not trusted     | The release server certificate is not trusted.                   |
| The proxy refuses or fails                | The proxy server did not connect Kalkidan to the release server. |
| No network, or no DNS                     | The release server cannot be reached.                            |
| No answer in time                         | The release server did not answer in time.                       |
| GitHub limits the requests of the network | The release server limits the requests from this network now.    |

To trust an enterprise certificate authority, add it to the system trust store. On an SSH host,
you can also set `NODE_EXTRA_CA_CERTS` to a PEM file in the shell profile that SSH reads.

## SSH host without access to the release server

When an SSH host cannot reach `github.com`, or GitHub limits its requests, its row in Settings › Computers shows **Copy from this computer**
next to the error. Then:

1. This computer finds the newest release for the operating system and processor of the host.
2. This computer downloads the signed manifest, the signatures, and the archive. It verifies the
   signature of the manifest, the SHA-256 digest of the archive, and the signature of the archive.
3. The helper verifies the signed manifest and the archive signature before it accepts data. The
   host applies its own release checkpoint, so an older release cannot replace a newer one.
4. This computer sends the archive in parts of 1 MiB over the existing SSH connection. OpenSSH
   authenticates and encrypts the connection.
5. The host verifies the size, the SHA-256 digest, and the signature of the archive again. Then it
   installs the runtime and checks its version.

The host deletes a partial copy when the copy stops, when a part is out of order, or after 5
minutes without data. Only one copy runs for each host at a time.

## Sleep and wake, and network changes

Timers do not count the time while a computer sleeps. A network change closes connections. After
a wake, and when the network comes back or changes, Kalkidan:

1. Stops each managed gateway whose credential expired during the sleep.
2. Checks each SSH connection, and reconnects the hosts that do not answer.
3. Renews the account session when it expires soon.
4. Checks for a runtime release when the last check failed.

Kalkidan never replays a request or a mutation. The main process reads the network state every 5
seconds, because Electron has no event for a network change in the main process.

## Clock difference

Kalkidan accepts a clock that is up to 5 minutes slow for runtime credentials and release
manifests. This value is a user decision. A larger difference shows: "The clock of this computer
is wrong. Set the date and time to update automatically, then try again." The runtime still
expires at the time that Verdictan sets.

## Headless Linux and computers without a keyring

An SSH host often has no display, no D-Bus session, and no Secret Service keyring.

- The helper starts without a display and without a keyring.
- Verdictan CLI 0.6.10 and earlier need the keyring for the version check of a new runtime. On
  Linux, Kalkidan then uses `verdictan --version`. The installer already verified the digest of the
  executable against the signed release. Later CLI releases do not need the keyring for this
  check.
- On Linux without a keyring, Electron stores secrets as plain text (`basic_text`). Kalkidan does
  not import browser passwords in that case.

## Tests

| Condition                       | Test                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Sleep and wake                  | `tests/network-platform.test.ts`, `tests/desktop-backend.test.ts`                                             |
| Network change                  | `tests/network-platform.test.ts`                                                                              |
| Clock difference                | `tests/network-platform.test.ts`, `tests/verdictan-release.test.ts`                                           |
| Corporate proxy (`HTTPS_PROXY`) | `tests/network-proxy-native.test.ts` (real proxy and HTTPS server)                                            |
| Enterprise certificates         | `tests/network-proxy-native.test.ts` (`NODE_EXTRA_CA_CERTS`), `tests/network-platform.test.ts` (system store) |
| Headless Linux                  | `tests/headless-linux.mjs` (CI runs `--status-only` in the `ci/` container)                                   |
| No keyring                      | `tests/runtime-probe.test.ts`, `tests/browser-profile-backend.test.ts`, `tests/headless-linux.mjs`            |
| Copy over SSH                   | `tests/verdictan-transfer.test.ts`, `tests/headless-linux.mjs --offline`                                      |

To test a real SSH host with Docker, run `npm run build:electron`, then:

```bash
node --import tsx tests/headless-linux.mjs --ssh <host> --docker node:24.21.0-bookworm-slim --offline
```
