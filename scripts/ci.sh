#!/usr/bin/env bash
set -euo pipefail
npm ci
npm run lint
npm run format:check
npm run check:architecture
npm run test:backend:coverage
npm test
npm run build
npx playwright install chromium
npm run test:ci:ui
node tests/memory-processes.mjs
node tests/io-remote.mjs
# The SSH helper on headless Linux: no display, no D-Bus session, and no keyring.
node --import tsx tests/headless-linux.mjs --status-only
# Release requests on Chromium: a PAC file, a proxy that asks for a sign-in, and an enterprise root.
node tests/network-electron.mjs
DEBUG=pw:browser node tests/docs-desktop.mjs
