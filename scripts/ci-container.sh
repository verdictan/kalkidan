#!/usr/bin/env bash
set -euo pipefail
buildctl build --frontend dockerfile.v0 \
  --local context=. --local dockerfile=ci \
  --opt "build-arg:CI_RUN_ID=${BUILD_TAG:-local-$(date +%s)}" \
  --output type=local,dest=ci-results
status=$(cat ci-results/exit-code)
[[ "$status" =~ ^[0-9]+$ ]] || { echo 'Missing valid CI test result' >&2; exit 1; }
exit "$status"
