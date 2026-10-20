import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, isAbsolute } from 'node:path';
import { release } from 'node:os';

const run = promisify(execFile);
const output = resolve('ci-results', `native-${process.platform}-${process.arch}`);
await mkdir(output, { recursive: true });
const agents = { codex: process.env.KALKIDAN_CODEX_PATH, claude: process.env.KALKIDAN_CLAUDE_PATH };
for (const [agent, path] of Object.entries(agents)) {
  if (!path || !isAbsolute(path))
    throw new Error(
      `Set KALKIDAN_${agent.toUpperCase()}_PATH to an absolute native executable path.`,
    );
}
for (const entry of ['native-agent', 'isolation'])
  await build({
    entryPoints: [`tests/acceptance/${entry}.ts`],
    bundle: true,
    platform: 'node',
    outfile: resolve(output, `${entry}.cjs`),
    logLevel: 'silent',
  });
const evidence = {
  platform: process.platform,
  architecture: process.arch,
  kernel: release(),
  recordedAt: new Date().toISOString(),
  scope: 'native-adapter-and-isolation',
  syntheticProvider: true,
  gatewayAcceptance: false,
  cases: [],
};
let failed = false;
for (const [agent, binary] of Object.entries(agents)) {
  const sha256 = createHash('sha256')
    .update(await readFile(binary))
    .digest('hex');
  for (const mode of [
    'isolation',
    'complete',
    'tool',
    'cancel',
    'error',
    'partial',
    'resume',
    'fork',
  ]) {
    try {
      const file = resolve(output, mode === 'isolation' ? 'isolation.cjs' : 'native-agent.cjs');
      const result = await run(process.execPath, [file, agent, binary, mode], {
        timeout: 90000,
        maxBuffer: 262144,
      });
      const record = JSON.parse(result.stdout.trim());
      evidence.cases.push({ ...record, mode, executableSha256: sha256, status: 'passed' });
      console.log(`${agent} ${mode}: passed`);
    } catch {
      // Do not archive process output: future fixtures can contain private source material.
      evidence.cases.push({ agent, mode, executableSha256: sha256, status: 'failed' });
      console.error(`${agent} ${mode}: failed`);
      failed = true;
    }
    await writeFile(resolve(output, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
}
process.exitCode = failed ? 1 : 0;
