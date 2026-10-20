import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { writeJSON } from '../storage/atomic-json';
import { withDirectoryLock } from '../storage/directory-lock';
import { parseWorktrees } from '../core';
import { worktreeFolder } from '../git-working';
export class WorktreeCreation {
  constructor(
    private root: string,
    private git: (cwd: string, args: string[]) => Promise<string>,
  ) {}
  async run(cwd: string, branch: string, projectRoot: string, operationId: string = randomUUID()) {
    if (
      typeof branch !== 'string' ||
      !branch ||
      branch.startsWith('-') ||
      branch.length > 200 ||
      !/^[a-f0-9-]{36}$/.test(operationId)
    )
      throw new Error('Invalid worktree request.');
    cwd = await realpath(cwd);
    projectRoot = await realpath(projectRoot);
    await this.git(cwd, ['check-ref-format', '--branch', branch]);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    return withDirectoryLock(
      this.root,
      async (assertOwned) => {
        const file = join(this.root, `${operationId}.json`);
        let saved: {
          cwd: string;
          branch: string;
          projectRoot: string;
          path: string;
          phase: string;
        };
        try {
          const text = await readFile(file, 'utf8');
          if (text.length > 20000) throw new Error('Invalid worktree receipt.');
          saved = JSON.parse(text);
        } catch (error: any) {
          if (error.code !== 'ENOENT') throw error;
          saved = {
            cwd,
            branch,
            projectRoot,
            path: worktreeFolder(projectRoot, basename(cwd), branch, existsSync),
            phase: 'reserved',
          };
        }
        if (saved.cwd !== cwd || saved.branch !== branch || saved.projectRoot !== projectRoot)
          throw new Error('The worktree request belongs to another project or branch.');
        const trees = parseWorktrees(await this.git(cwd, ['worktree', 'list', '--porcelain']));
        const found = trees.find((tree) => tree.path === saved.path);
        if (found) {
          if (found.branch !== branch)
            throw new Error('The reserved worktree has a different branch.');
          return realpath(found.path);
        }
        if (saved.phase === 'completed' || saved.phase === 'creating')
          throw new Error(
            'The previous worktree result is uncertain. Inspect the reserved folder before starting another operation.',
          );
        if (existsSync(saved.path))
          throw new Error('The reserved folder already exists. No files were removed.');
        assertOwned();
        saved.phase = 'creating';
        await writeJSON(file, saved);
        await this.git(cwd, ['worktree', 'add', '-b', branch, '--', saved.path]);
        assertOwned();
        saved.phase = 'completed';
        await writeJSON(file, saved);
        return realpath(saved.path);
      },
      createHash('sha256').update(operationId).digest('hex'),
    );
  }
}
