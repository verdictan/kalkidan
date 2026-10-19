#!/usr/bin/env bash
set -euo pipefail
# Jenkins supplies TAG_NAME from tag discovery, never from a build parameter.
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const {version} = JSON.parse(readFileSync('package.json', 'utf8'));
const tag = process.env.TAG_NAME;
if (tag !== `v${version}`) throw new Error(`Expected release tag v${version}`);
const commit = ref => execFileSync('git', ['rev-parse', '--verify', ref], {encoding:'utf8'}).trim();
if (commit(`refs/tags/${tag}^{commit}`) !== commit('HEAD')) throw new Error('Release tag does not match checkout');
JS
# Untrusted build workers never receive signing or publishing credentials.
unset CSC_LINK CSC_KEY_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID GH_TOKEN GITHUB_TOKEN
export CSC_IDENTITY_AUTO_DISCOVERY=false
for arch in arm64 x64; do
  npx electron-builder --mac --"$arch" --publish never -c.mac.identity=null -c.mac.notarize=false
done
(
  cd release
  shasum -a 256 ./*.dmg ./*.zip > SHA256SUMS.txt
)
