import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PtyTerminal } from '../electron/pty-terminal';
test('PTY keeps shell state, reports TTY dimensions, handles interrupt, and exits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-pty-'));
  await mkdir(join(root, 'child'));
  const old = process.env.SHELL;
  process.env.SHELL = '/bin/sh';
  const terminal = new PtyTerminal();
  try {
    const { id } = await terminal.open(root, 80, 24);
    let cursor = 0;
    async function until(text: string) {
      let output = '';
      for (let i = 0; i < 150; i++) {
        const state = terminal.read(id, cursor);
        cursor = state.cursor;
        output += state.data;
        if (output.includes(text)) return output;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.fail('Missing ' + text + ' in ' + output);
    }
    terminal.write(id, 'cd child; export KALKIDAN_PTY_TEST=retained\r');
    terminal.write(
      id,
      "printf 'state:%s\\n' \"$KALKIDAN_PTY_TEST\"; pwd; test -t 0 && printf 'real-%s\\n' tty\r",
    );
    const output = await until('real-tty');
    assert.match(output, /state:retained/);
    assert.match(output, /kalkidan-pty-.*\/child/);
    terminal.resize(id, 100, 35);
    terminal.write(id, 'stty size\r');
    await until('35 100');
    terminal.write(id, 'sleep 30\r');
    await new Promise((r) => setTimeout(r, 100));
    terminal.write(id, '\x03');
    terminal.write(id, "printf 'after-%s\\n' interrupt\r");
    await until('after-interrupt');
    terminal.close(id);
    assert.equal(terminal.read(id, 0).exited, true);
  } finally {
    terminal.closeAll();
    if (old === undefined) delete process.env.SHELL;
    else process.env.SHELL = old;
    await rm(root, { recursive: true, force: true });
  }
});
