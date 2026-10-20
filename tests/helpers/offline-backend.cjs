// Fail closed if a deterministic backend test reaches a live external boundary.
const net = require('node:net');
const tls = require('node:tls');
const childProcess = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const deny = (boundary) =>
  function () {
    throw new Error(`Unexpected live ${boundary} in deterministic backend tests`);
  };
net.Socket.prototype.connect = deny('network connection');
tls.connect = deny('TLS connection');
const spawn = childProcess.spawn;
const esbuild = fs.realpathSync(
  require.resolve(
    '@esbuild/' +
      process.platform +
      '-' +
      process.arch +
      (process.platform === 'win32' ? '/esbuild.exe' : '/bin/esbuild'),
  ),
);
childProcess.spawn = function (file, args, options) {
  // tsx needs the pinned esbuild compiler. No application command may start.
  if (
    typeof file === 'string' &&
    path.isAbsolute(file) &&
    fs.existsSync(file) &&
    fs.realpathSync(file) === esbuild &&
    args?.some((arg) => arg.startsWith('--service='))
  )
    return spawn(file, args, options);
  throw new Error('Unexpected live child process in deterministic backend tests');
};
for (const method of ['exec', 'execFile', 'execSync', 'execFileSync', 'spawnSync', 'fork'])
  childProcess[method] = deny('child process');
require('node:module').syncBuiltinESMExports();
