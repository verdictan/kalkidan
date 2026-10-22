#!/usr/bin/env bash
# Check a downloaded Kalkidan installer on a clean computer. See docs/clean-machine-installer-test.md.
#
# Usage: scripts/installer-check.sh <installer> [--sums SHA256SUMS.txt] [--launch] [--install]
#   <installer>  A .dmg or .zip (macOS), or an .AppImage or .deb (Linux).
#   --sums       The SHA256SUMS.txt file of the same release. The script compares the digest.
#   --launch     Start the app for the first time, and wait for the managed agents runtime to
#                install. This uses the network. It runs only on a computer without a Kalkidan
#                profile, because a packaged app always uses the profile of the user.
#   --install    Linux .deb only: install the package with apt. This needs root.
#
# The script needs only the tools of the operating system. It does not need Node.js or the
# Kalkidan source. Without --launch, it changes nothing outside a temporary folder.
set -uo pipefail

installer=""
sums=""
launch=false
install=false
while (($#)); do
  case "$1" in
    --sums) sums="${2:-}"; shift 2 ;;
    --launch) launch=true; shift ;;
    --install) install=true; shift ;;
    -h | --help) sed -n '2,13p' "$0"; exit 0 ;;
    *) installer="$1"; shift ;;
  esac
done
[[ -f "$installer" ]] || { echo "Give the path of a downloaded installer." >&2; exit 2; }

passed=0
failed=0
skipped=0
pass() { echo "PASS $*"; passed=$((passed + 1)); }
fail() { echo "FAIL $*"; failed=$((failed + 1)); }
skip() { echo "SKIP $*"; skipped=$((skipped + 1)); }
work="$(mktemp -d "${TMPDIR:-/tmp}/kalkidan-installer-check.XXXXXX")"
mounted=""
app_pid=""
cleanup() {
  [[ -n "$app_pid" ]] && kill "$app_pid" 2>/dev/null
  [[ -n "$mounted" ]] && hdiutil detach -quiet "$mounted" 2>/dev/null
  rm -rf "$work"
}
trap cleanup EXIT

name="$(basename "$installer")"
echo "Installer: $name"
echo "Computer: $(uname -s) $(uname -r) $(uname -m)"

# 1. The digest matches the published checksum.
if command -v sha256sum >/dev/null; then
  digest="$(sha256sum "$installer" | cut -d' ' -f1)"
else
  digest="$(shasum -a 256 "$installer" | cut -d' ' -f1)"
fi
echo "SHA-256: $digest"
if [[ -n "$sums" ]]; then
  expected="$(awk -v file="$name" '$2 == file || $2 == "*" file { print $1 }' "$sums")"
  if [[ -z "$expected" ]]; then
    fail "the checksum file has no line for $name"
  elif [[ "$expected" == "$digest" ]]; then
    pass "the digest matches the published SHA256SUMS.txt"
  else
    fail "the digest does not match the published SHA256SUMS.txt"
  fi
else
  skip "no --sums file, so the digest is not compared"
fi

# The Electron program of an app. It must match the processor of this computer.
check_architecture() {
  local binary="$1" machine archs
  machine="$(uname -m)"
  [[ "$machine" == "aarch64" ]] && machine=arm64
  [[ "$machine" == "x86_64" && "$(uname -s)" == "Darwin" ]] && machine=x86_64
  if command -v lipo >/dev/null; then
    archs="$(lipo -archs "$binary" 2>/dev/null)"
  else
    archs="$(file -b "$binary")"
    [[ "$archs" == *x86-64* ]] && archs=x86_64
    [[ "$archs" == *aarch64* ]] && archs=arm64
  fi
  if [[ " $archs " == *" $machine "* || "$archs" == "$machine" ]]; then
    pass "the app is built for this processor ($archs)"
  else
    fail "the app is built for $archs, and this computer is $machine"
  fi
}

# The folders where Kalkidan keeps a profile. A clean computer has none of them.
existing_profile() {
  local folder
  for folder in "$HOME/.kalkidan" "$HOME/Library/Application Support/Kalkidan" \
    "$HOME/Library/Application Support/kalkidan" "${XDG_CONFIG_HOME:-$HOME/.config}/Kalkidan" \
    "${XDG_CONFIG_HOME:-$HOME/.config}/kalkidan"; do
    [[ -e "$folder" ]] && { echo "$folder"; return 0; }
  done
  return 1
}

# Start the app for the first time. Wait until the managed agents runtime installs.
launch_app() {
  local program="$1" found
  shift
  # A packaged app ignores test profiles and moves an earlier profile into ~/.kalkidan. Never
  # start it where a profile exists: that is not a clean computer, and the start changes it.
  if found="$(existing_profile)"; then
    skip "a Kalkidan profile exists at $found, so this is not a clean computer. The app does not start"
    return
  fi
  "$program" "$@" >"$work/app.log" 2>&1 &
  app_pid=$!
  sleep 15
  if kill -0 "$app_pid" 2>/dev/null; then
    pass "the app starts and keeps running with a new profile"
  else
    fail "the app stopped after it started. Log: $(tail -c 600 "$work/app.log")"
    app_pid=""
    return
  fi
  local journal="$HOME/.kalkidan/runtime/verdictan/installation.json" phase=""
  for _ in $(seq 1 60); do
    if [[ -f "$journal" ]]; then
      phase="$(grep -o '"phase":"[a-z-]*"' "$journal" | head -1 | cut -d'"' -f4)"
      [[ "$phase" =~ ^(completed|failed|canceled|rolled-back|rollback-failed)$ ]] && break
    fi
    sleep 5
  done
  if [[ "$phase" == "completed" ]]; then
    pass "the first start installs the signed managed agents runtime"
  elif [[ -n "$phase" ]]; then
    fail "the runtime install ended as '$phase': $(grep -o '"error":"[^"]*"' "$journal" | head -1)"
  else
    fail "the runtime install did not start in 5 minutes. Settings shows the cause. Log: $(tail -c 400 "$work/app.log")"
  fi
  kill "$app_pid" 2>/dev/null
  wait "$app_pid" 2>/dev/null
  app_pid=""
  echo "The new profile stays at $HOME/.kalkidan for the manual checks."
}

case "$name" in
  *.dmg | *.zip)
    [[ "$(uname -s)" == "Darwin" ]] || { fail "a macOS installer needs a Mac"; exit 1; }
    if xattr -p com.apple.quarantine "$installer" >/dev/null 2>&1; then
      pass "the download has the quarantine attribute, as a browser download does"
    else
      skip "the download has no quarantine attribute, so Gatekeeper does not check it as a browser download"
    fi
    if [[ "$name" == *.dmg ]]; then
      hdiutil verify -quiet "$installer" && pass "the disk image checksum is valid" ||
        fail "the disk image is damaged"
      mounted="$work/volume"
      mkdir -p "$mounted"
      if hdiutil attach -quiet -nobrowse -readonly -mountpoint "$mounted" "$installer"; then
        pass "the disk image opens"
      else
        fail "the disk image does not open"
        mounted=""
        exit 1
      fi
      [[ -L "$mounted/Applications" ]] && pass "the disk image has the Applications shortcut" ||
        fail "the disk image has no Applications shortcut"
      source_app="$(find "$mounted" -maxdepth 1 -name '*.app' -print -quit)"
    else
      ditto -x -k "$installer" "$work/unzipped" && pass "the archive opens" || fail "the archive does not open"
      source_app="$(find "$work/unzipped" -maxdepth 1 -name '*.app' -print -quit)"
    fi
    [[ -n "$source_app" ]] || { fail "the installer has no app"; exit 1; }
    # Copy as Finder does, so the quarantine attribute stays on the copy.
    app="$work/Applications/$(basename "$source_app")"
    mkdir -p "$work/Applications"
    ditto "$source_app" "$app"
    if xattr -p com.apple.quarantine "$installer" >/dev/null 2>&1; then
      xattr -w com.apple.quarantine "$(xattr -p com.apple.quarantine "$installer")" "$app"
    fi
    executable="$app/Contents/MacOS/$(defaults read "$app/Contents/Info" CFBundleExecutable)"
    check_architecture "$executable"
    echo "Version: $(defaults read "$app/Contents/Info" CFBundleShortVersionString 2>/dev/null)"
    if codesign --verify --deep --strict "$app" 2>"$work/codesign.log"; then
      pass "the code signature is valid"
    else
      fail "the code signature is not valid: $(head -c 300 "$work/codesign.log")"
    fi
    authority="$(codesign -dvv "$app" 2>&1 | grep '^Authority=' | head -1 | cut -d= -f2-)"
    if [[ -n "$authority" ]]; then
      pass "the app is signed by: $authority"
    else
      fail "the app has no Developer ID signature (ad hoc or none). Gatekeeper blocks it on a clean Mac"
    fi
    if spctl --assess --type execute "$app" 2>"$work/spctl.log"; then
      pass "Gatekeeper accepts the app"
    else
      fail "Gatekeeper rejects the app: $(head -c 300 "$work/spctl.log")"
    fi
    if xcrun stapler validate "$app" >/dev/null 2>&1; then
      pass "the notarization ticket is stapled"
    else
      fail "no notarization ticket is stapled to the app"
    fi
    if $launch; then
      launch_app "$executable"
    else
      skip "no --launch, so the app does not start"
    fi
    ;;
  *.AppImage)
    [[ "$(uname -s)" == "Linux" ]] || { fail "an AppImage needs Linux"; exit 1; }
    chmod +x "$installer" 2>/dev/null || cp "$installer" "$work/app.AppImage"
    cd "$work" || exit 1
    if "$installer" --appimage-extract >/dev/null 2>&1; then
      pass "the AppImage opens without FUSE"
    else
      fail "the AppImage does not open"
      exit 1
    fi
    executable="$(find "$work/squashfs-root" -maxdepth 1 -type f -name 'kalkidan' -print -quit)"
    [[ -n "$executable" ]] || { fail "the AppImage has no kalkidan program"; exit 1; }
    check_architecture "$executable"
    missing="$(ldd "$executable" 2>/dev/null | grep 'not found' | awk '{print $1}' | tr '\n' ' ')"
    [[ -z "$missing" ]] && pass "all shared libraries are present" ||
      fail "shared libraries are missing: $missing"
    if $launch; then
      flags=(--no-sandbox)
      [[ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] && flags+=(--ozone-platform=headless)
      launch_app "$executable" "${flags[@]}"
    else
      skip "no --launch, so the app does not start"
    fi
    ;;
  *.deb)
    command -v dpkg-deb >/dev/null || { fail "a .deb needs dpkg-deb"; exit 1; }
    dpkg-deb --info "$installer" >"$work/deb-info" && pass "the package metadata is valid" ||
      fail "the package metadata is not valid"
    grep -E '^ (Package|Version|Architecture|Depends):' "$work/deb-info"
    dpkg-deb --contents "$installer" | grep -q '/opt/Kalkidan/kalkidan$' &&
      pass "the package has /opt/Kalkidan/kalkidan" || fail "the package has no /opt/Kalkidan/kalkidan"
    if $install; then
      if [[ "$(id -u)" == 0 ]] && apt-get install -y "$(realpath "$installer")" >"$work/apt.log" 2>&1; then
        pass "apt installs the package and its dependencies"
        check_architecture /opt/Kalkidan/kalkidan
        if $launch; then
          flags=(--no-sandbox)
          [[ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] && flags+=(--ozone-platform=headless)
          launch_app /opt/Kalkidan/kalkidan "${flags[@]}"
        fi
      else
        fail "apt did not install the package (root is necessary): $(tail -c 400 "$work/apt.log" 2>/dev/null)"
      fi
    else
      skip "no --install, so the package is not installed"
    fi
    ;;
  *)
    echo "Unknown installer type: $name" >&2
    exit 2
    ;;
esac

echo "$passed passed, $failed failed, $skipped skipped"
[[ "$failed" == 0 ]]
