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
DEBUG=pw:browser node tests/docs-desktop.mjs
