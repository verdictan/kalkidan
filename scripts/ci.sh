#!/usr/bin/env bash
set -euo pipefail
npm ci
npm run check:architecture
npm test
npm run build
npx playwright install chromium
npm run test:ci:ui
DEBUG=pw:browser node tests/docs-desktop.mjs
node tests/io-remote.mjs
