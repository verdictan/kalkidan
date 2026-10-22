# Test a downloaded installer on a clean computer

Use this checklist before you publish a Kalkidan release. A clean computer has no Kalkidan, no
`~/.kalkidan` folder, no Node.js, no developer tools, and no earlier keychain or keyring entries.
Use a new virtual machine, or a new user account on a computer.

`scripts/installer-check.sh` does the automatic checks. It needs only the tools of the operating
system. Copy the script to the clean computer with the installer.

## Prepare

1. Download the installer with a web browser, not with `curl` or `gh`. A browser adds the
   quarantine attribute on macOS, so Gatekeeper checks the app as it does for a user.
2. Download `SHA256SUMS.txt` of the same release.
3. Write down the operating system version and the processor type.

## Automatic checks

Run the script:

```bash
bash installer-check.sh ~/Downloads/<installer> --sums ~/Downloads/SHA256SUMS.txt --launch
```

The script checks:

- The SHA-256 digest matches `SHA256SUMS.txt`.
- macOS: the disk image is valid, opens, and has the Applications shortcut. The app matches the
  processor. The code signature, the Developer ID, Gatekeeper, and the notarization ticket are
  valid.
- Linux: the AppImage opens without FUSE, the program matches the processor, and all shared
  libraries are present. The `.deb` metadata is valid. With `--install` as root, apt installs the
  package and its dependencies.
- With `--launch`: the app starts with an empty, temporary profile and keeps running. The first
  start downloads, verifies, and installs the managed agents runtime.

The script does not change the profile of the user. `--launch` uses a temporary profile, and the
script deletes it at the end.

## Manual checks

Do these steps as a new user would. Record a screenshot of each dialog.

1. Open the installer from the Downloads folder.
   - macOS: drag Kalkidan to Applications. Open it from Launchpad. No dialog may say that the app
     is damaged or that the developer is not known.
   - Windows: run the `.exe`. Record the SmartScreen dialog, if one opens.
   - Linux: open the AppImage, or install the `.deb` with the software center.
2. Make sure that the first window opens in less than 10 seconds, and that the onboarding shows.
3. Select **Set up later**. Make sure that Settings › Computers shows the managed agents runtime as
   installed, or shows its install progress.
4. Sign in to Verdictan. Make sure that the system browser opens and that the sign-in completes.
5. macOS: make sure that the keychain dialog names Kalkidan or Verdictan. Allow access.
6. Start a chat with a managed agent. Make sure that the policy and usage of the request show.
7. Turn off the network. Make sure that Kalkidan shows a clear error and does not stop.
8. Put the computer to sleep for 20 minutes. Wake it. Make sure that the chat and the SSH hosts
   reconnect and that the account stays signed in.
9. Quit Kalkidan. Open it again. Make sure that it opens without a second runtime download.
10. Delete the app. Make sure that the removal of the app and `~/.kalkidan` leaves no running
    process.

Behind a corporate proxy, also do steps 2 to 6 with the proxy of the organization and its
certificate authority in the system trust store.

## Results of the last run

Date: 2026-10-22. Installer: `Kalkidan-0.1.0-build.1792665259.ac73aedffa70-mac-arm64.dmg`, a
release built from `main` before this change. Computer: a Mac with Apple silicon (macOS 26.7.1),
the developer account, not a clean computer.

| Check                                                  | Result                                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Digest matches `SHA256SUMS.txt`                        | Pass                                                                                                                     |
| Disk image valid, opens, has the Applications shortcut | Pass                                                                                                                     |
| App matches the processor (arm64)                      | Pass                                                                                                                     |
| Code signature valid                                   | **Fail**: "code has no resources but signature indicates they must be present"                                           |
| Developer ID signature                                 | **Fail**: the release build turns off signing (`mac.identity=null`)                                                      |
| Gatekeeper accepts the app                             | **Fail**                                                                                                                 |
| Notarization ticket                                    | **Fail**: the release build turns off notarization                                                                       |
| App starts from a quarantined copy                     | **Fail**: macOS stops the process at once (SIGKILL)                                                                      |
| App starts without the quarantine attribute            | Pass                                                                                                                     |
| First start installs the runtime                       | **Fail** on this release: discovery read 100 releases in one 5 MB page, more than its 4 MiB limit. This change fixes it. |

The packaged app from this change: see the pull request for the result.

## What still needs a clean computer

These checks were not run, because no clean computer or virtual machine was available:

- A new macOS user, or a macOS virtual machine, with no earlier keychain entries. This needs an
  administrator password, which the automatic run cannot give.
- The Gatekeeper dialogs that a user sees for a browser download.
- Windows: the installer, SmartScreen, and the first start.
- Linux desktop: the AppImage and the `.deb` with a display, a keyring, and the software center.
- The manual checks 1 to 10.
