#!/usr/bin/env bash
set -euo pipefail
# The CI image has dependencies and Chromium. Local runs install them here.
if [[ "${KALKIDAN_CI_CONTAINER:-}" != 1 ]]; then
  npm ci --prefer-offline --no-audit --no-fund
  npx playwright install chromium
fi
mkdir -p ci-results
step() {
  local name="$1" started=$SECONDS
  shift
  "$@"
  printf '%s\t%s\n' "$name" "$((SECONDS - started))" >> ci-results/timings.tsv
}
step lint npm run lint
step format npm run format:check
step architecture npm run check:architecture
step build npm run build
# Keep two lanes. Desktop tests share a display and must run in sequence.
backend() {
  step backend-coverage npm run test:backend:coverage
  step unit node --import tsx --test --test-concurrency=2 tests/*.test.ts
}
desktop() {
  step browser npm run test:ci:ui
  step memory node tests/memory-processes.mjs
  step remote-io node tests/io-remote.mjs
  step headless node --import tsx tests/headless-linux.mjs --status-only
  step network node tests/network-electron.mjs
  step desktop-docs node tests/docs-desktop.mjs
}
backend > ci-results/backend.log 2>&1 &
backend_pid=$!
desktop > ci-results/desktop.log 2>&1 &
desktop_pid=$!
# Wait for both lanes and preserve either failure. Always show their logs.
status=0
wait "$backend_pid" || status=1
wait "$desktop_pid" || status=1
cat ci-results/backend.log ci-results/desktop.log
exit "$status"
