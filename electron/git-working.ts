import { realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { exec, parseWorktrees } from './core';
import type { WorkingFile, WorkingFileStatus, WorkingStatus } from '../src/api/contracts';

type Run = (cwd: string, args: string[], timeout?: number) => Promise<string>;
type GitHubCli = () => Promise<{ path: string; env: NodeJS.ProcessEnv; args?: string[] }>;

// Git must not stop and wait for a password prompt that nobody can see.
const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0' });

/** Returns the useful part of a failed command. It does not include the command arguments. */
function failure(error: any, fallback: string) {
  const detail = String(error?.stderr || error?.stdout || '')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('Command failed:'))
    .join('\n')
    .trim();
  return new Error(detail ? detail.slice(-800) : fallback);
}

const runGit: Run = async (cwd, args, timeout = 15000) => {
  try {
    return (
      await exec('git', ['-C', cwd, ...args], {
        timeout,
        maxBuffer: 8 * 1024 * 1024,
        env: gitEnv(),
      })
    ).stdout;
  } catch (error) {
    throw failure(error, 'Git could not complete this action.');
  }
};

/** Parses `git status --porcelain=v2 --branch -z`. */
export function parseWorkingStatus(output: string) {
  const fields = output.split('\0');
  let branch = '';
  let upstream = false;
  let ahead = 0;
  let changed = 0;
  let untracked = 0;
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    if (field.startsWith('# branch.head ')) branch = field.slice(14);
    else if (field.startsWith('# branch.upstream ')) upstream = true;
    else if (field.startsWith('# branch.ab ')) ahead = Number(/\+(\d+)/.exec(field)?.[1] || 0);
    else if (field.startsWith('1 ') || field.startsWith('u ')) changed++;
    else if (field.startsWith('2 ')) {
      changed++;
      i++; // A rename or copy entry has the original path in the next field.
    } else if (field.startsWith('? ')) untracked++;
  }
  return { branch: branch === '(detached)' ? 'HEAD' : branch, upstream, ahead, changed, untracked };
}

export async function defaultBranch(cwd: string, run: Run = runGit) {
  try {
    const head = (
      await run(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
    ).trim();
    if (head.startsWith('origin/')) return head.slice(7);
  } catch {
    /* Use a common branch name when origin does not report a default branch. */
  }
  for (const name of ['main', 'master'])
    for (const ref of [`refs/remotes/origin/${name}`, `refs/heads/${name}`]) {
      try {
        await run(cwd, ['show-ref', '--verify', '--quiet', ref]);
        return name;
      } catch {
        /* Try the next name. */
      }
    }
  return 'main';
}

export async function workingStatus(cwd: string, run: Run = runGit): Promise<WorkingStatus> {
  const [status, base] = await Promise.all([
    run(cwd, ['status', '--porcelain=v2', '--branch', '-z']),
    defaultBranch(cwd, run),
  ]);
  const value = parseWorkingStatus(status);
  let ahead = value.ahead;
  // A branch without an upstream has no ahead count. Compare it with the default branch.
  if (!value.upstream && value.branch && value.branch !== base) {
    for (const ref of [`origin/${base}`, base]) {
      try {
        ahead = Number((await run(cwd, ['rev-list', '--count', `${ref}..HEAD`])).trim()) || 0;
        break;
      } catch {
        /* Try the next reference. */
      }
    }
  }
  return {
    branch: value.branch,
    changed: value.changed,
    untracked: value.untracked,
    ahead,
    published: value.upstream,
    defaultBranch: base,
  };
}

/** Parses `git status --porcelain=v1 -z`. Ignored files are not included. */
export function parseWorkingFiles(output: string): WorkingFile[] {
  const fields = output.split('\0');
  const files: WorkingFile[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (field.length < 4) continue;
    const x = field[0];
    const y = field[1];
    const path = field.slice(3);
    if (x === '!') continue;
    if (x === '?') {
      files.push({ path, status: 'untracked' });
      continue;
    }
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      // A rename or copy entry has the original path in the next field.
      const from = fields[++i];
      if (x === 'R' || y === 'R')
        files.push({ path, status: 'renamed', ...(from ? { from } : {}) });
      else files.push({ path, status: 'added' });
      continue;
    }
    const status: WorkingFileStatus =
      x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
        ? 'conflicted'
        : x === 'A'
          ? 'added'
          : x === 'D' || y === 'D'
            ? 'deleted'
            : 'modified';
    files.push({ path, status });
  }
  return files;
}

export async function workingFiles(cwd: string, run: Run = runGit) {
  return parseWorkingFiles(
    await run(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  );
}

/**
 * Stages and commits changes. With `files`, it commits only those paths. Other staged changes
 * stay staged. Without `files`, it stages and commits all changes.
 */
export async function gitCommit(cwd: string, message: string, files?: string[], run: Run = runGit) {
  if (typeof message !== 'string' || !message.trim()) throw new Error('Enter a commit message.');
  if (message.length > 20000) throw new Error('The commit message is too long.');
  if (files === undefined || files === null) {
    const status = await run(cwd, ['status', '--porcelain']);
    if (!status.trim()) throw new Error('There are no changes to commit.');
    await run(cwd, ['add', '-A']);
    // Commit hooks can take some time.
    await run(cwd, ['commit', '-m', message.trim()], 120000);
  } else {
    if (!Array.isArray(files) || files.some((file) => typeof file !== 'string' || !file))
      throw new Error('Choose the files to commit.');
    if (!files.length) throw new Error('Choose at least one file to commit.');
    const changed = new Map((await workingFiles(cwd, run)).map((file) => [file.path, file]));
    const paths = new Set<string>();
    const add = new Set<string>();
    for (const file of files) {
      const entry = changed.get(file);
      if (!entry) throw new Error(`${file} has no changes to commit.`);
      if (entry.status === 'conflicted') throw new Error(`Resolve the conflict in ${file} first.`);
      paths.add(file);
      add.add(file);
      // Commit both sides of a rename, so the old path is not left behind.
      if (entry.from) paths.add(entry.from);
    }
    // Literal pathspecs keep characters such as "*" in file names from matching other files.
    // The old path of a staged rename is not in the index or the folder, so do not stage it.
    await run(cwd, ['--literal-pathspecs', 'add', '-A', '--', ...add]);
    await run(
      cwd,
      ['--literal-pathspecs', 'commit', '--only', '-m', message.trim(), '--', ...paths],
      120000,
    );
  }
  return { commit: (await run(cwd, ['rev-parse', '--short', 'HEAD'])).trim() };
}

async function validBranch(cwd: string, branch: string, run: Run) {
  if (typeof branch !== 'string' || !branch.trim() || branch.startsWith('-') || branch.length > 200)
    throw new Error('Enter a valid new branch name.');
  try {
    await run(cwd, ['check-ref-format', '--branch', branch]);
  } catch {
    throw new Error(`"${branch}" is not a valid branch name.`);
  }
  return branch;
}

/** Creates a branch from the current state and switches to it. Uncommitted changes stay. */
export async function gitSwitchNewBranch(cwd: string, branch: string, run: Run = runGit) {
  await run(cwd, ['switch', '-c', await validBranch(cwd, branch, run)]);
}

/**
 * Returns the folder for a new worktree. The name is "{repository}-{branch}". When that
 * folder exists, a number is added: "-2", "-3", and so on.
 */
export function worktreeFolder(
  root: string,
  repository: string,
  branch: string,
  exists: (path: string) => boolean,
) {
  const base = join(root, 'worktrees', repository + '-' + branch.replace(/[\\/]/g, '-'));
  if (!exists(base)) return base;
  for (let n = 2; n < 1000; n++) if (!exists(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now()}`;
}

/**
 * Returns where a new worktree starts and the folder it uses. The worktree starts from the
 * current branch, or from the current commit when no branch is checked out.
 */
export async function worktreePreview(
  cwd: string,
  branch: string,
  root: string,
  exists: (path: string) => boolean,
  run: Run = runGit,
) {
  await validBranch(cwd, branch, run);
  let base = (await run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim();
  if (!base || base === 'HEAD')
    base = (await run(cwd, ['rev-parse', '--short', 'HEAD']).catch(() => '')).trim() || 'HEAD';
  return { base, path: worktreeFolder(root, basename(cwd), branch, exists) };
}

/**
 * Removes the linked worktree at `cwd` with `git worktree remove`. It does not remove the
 * main checkout. It does not remove a worktree with uncommitted changes unless `force` is true.
 */
export async function removeWorktree(cwd: string, force = false, run: Run = runGit) {
  const path = await realpath(cwd);
  const top = await realpath((await run(path, ['rev-parse', '--show-toplevel'])).trim());
  const trees = parseWorktrees(await run(path, ['worktree', 'list', '--porcelain']));
  const main = trees[0] && (await realpath(trees[0].path).catch(() => trees[0].path));
  if (!main || top === main) throw new Error('The main checkout cannot be removed.');
  if (path !== top) throw new Error('Choose the top folder of the worktree.');
  if (!force && (await run(path, ['status', '--porcelain'])).trim())
    throw new Error('This worktree has uncommitted changes.');
  await run(main, ['worktree', 'remove', ...(force ? ['--force'] : []), '--', path], 60000);
}

export async function gitPullRequest(
  cwd: string,
  title: string,
  body: string,
  github: GitHubCli,
  run: Run = runGit,
) {
  if (typeof title !== 'string' || !title.trim()) throw new Error('Enter a pull request title.');
  if (typeof body !== 'string') throw new Error('Invalid pull request description.');
  const status = await workingStatus(cwd, run);
  if (!status.branch || status.branch === 'HEAD' || status.branch === status.defaultBranch)
    throw new Error('Create a branch before you open a pull request.');
  await run(cwd, ['push', '-u', 'origin', 'HEAD'], 120000);
  const gh = await github();
  try {
    // The `--name=value` form keeps a value that starts with "-" from being read as an option.
    const { stdout } = await exec(
      gh.path,
      [
        ...(gh.args || []),
        'pr',
        'create',
        `--title=${title.trim()}`,
        `--body=${body}`,
        `--head=${status.branch}`,
      ],
      { cwd, env: { ...gh.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 60000, maxBuffer: 1024 * 1024 },
    );
    const url = stdout
      .trim()
      .split('\n')
      .reverse()
      .find((line) => /^https:\/\/\S+$/.test(line.trim()));
    if (!url) throw new Error('GitHub did not return a pull request link.');
    return { url: url.trim() };
  } catch (error: any) {
    if (error.code === 'ENOENT') throw new Error('Install GitHub CLI and sign in, then try again.');
    if (error instanceof Error && !('stderr' in error)) throw error;
    throw failure(error, 'GitHub could not open the pull request.');
  }
}
