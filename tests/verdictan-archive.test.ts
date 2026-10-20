import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { crc32 } from 'node:zlib';
import { extractRuntime } from '../electron/verdictan/archive';
import type { RuntimeArtifact } from '../electron/verdictan/release';
// Stored ZIP records make the security fixtures independent of external archivers.
function zip(
  entries: { name: string; body?: string; mode?: number; flags?: number; size?: number }[],
) {
  const locals: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      body = Buffer.from(entry.body || 'runtime');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags || 0, 6);
    local.writeUInt32LE(crc32(body), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.size ?? body.length, 22);
    local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(0x0314, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(entry.flags || 0, 8);
    header.writeUInt32LE(crc32(body), 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(entry.size ?? body.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(((entry.mode ?? 0x81a4) << 16) >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    central.push(header, name);
    offset += local.length + name.length + body.length;
  }
  const end = Buffer.alloc(22),
    size = central.reduce((n, b) => n + b.length, 0);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}
test('Windows runtime extraction accepts only complete regular-file archives and preserves private modes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-zip-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifact = { os: 'win32' } as RuntimeArtifact;
  const valid = ['verdictan.exe', 'verdictan-update.exe', 'THIRD_PARTY_NOTICES.md'].map((name) => ({
    name,
  }));
  let index = 0;
  const extract = async (entries: Parameters<typeof zip>[0]) => {
    const archive = join(root, String(index++) + '.zip'),
      out = join(root, String(index++));
    await mkdir(out);
    await writeFile(archive, zip(entries));
    return extractRuntime(archive, out, artifact);
  };
  const executable = await extract(valid);
  assert.equal(await readFile(executable, 'utf8'), 'runtime');
  if (process.platform !== 'win32') assert.equal((await stat(executable)).mode & 0o777, 0o700);
  for (const entries of [
    valid.slice(0, 1),
    [...valid, valid[0]],
    [{ name: '../outside' }],
    [{ name: '/absolute' }],
    [{ name: 'verdictan.exe', mode: 0xa1ff }],
    [{ name: 'verdictan.exe', flags: 1 }],
    [{ name: 'unexpected.exe' }],
  ])
    await assert.rejects(extract(entries));
});
