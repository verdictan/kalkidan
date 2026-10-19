// CI and production installs do not need local Git hooks.
if (process.env.CI || process.env.HUSKY === '0' || process.env.NODE_ENV === 'production') {
  process.exit(0);
}
const { default: husky } = await import('husky');
const message = husky();
if (message) console.log(message);
