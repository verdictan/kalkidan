export default {
  '*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}': ['oxlint --fix', 'prettier --write'],
  '*.{json,jsonc,md,css,html,yml,yaml}': 'prettier --write',
};
