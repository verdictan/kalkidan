import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { withDirectoryLock } from '../storage/directory-lock';
import { writeJSON } from '../storage/atomic-json';
import { exec } from '../core';
import { defaultBranch, gitCommit } from '../git-working';
import type { PublishOperation, PublishRequest } from '../../src/domain/publish';
export interface PublishEffects {
  git(cwd: string, args: string[]): Promise<string>;
  commit(cwd: string, message: string, files?: string[]): Promise<{ commit: string }>;
  findPR(cwd: string, branch: string): Promise<string | undefined>;
  createPR(
    cwd: string,
    branch: string,
    title: string,
    body: string,
    draft?: boolean,
  ): Promise<string>;
}
export function publishEffects(
  github: () => Promise<{ path: string; args?: string[]; env: NodeJS.ProcessEnv }>,
): PublishEffects {
  const gh = async (cwd: string, args: string[], input?: string) => {
    const binary = await github();
    const command = exec(binary.path, [...(binary.args || []), ...args], {
      cwd,
      env: { ...binary.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });
    command.child.stdin?.on('error', () => {});
    command.child.stdin?.end(input);
    return (await command).stdout;
  };
  const origin = async (cwd: string) => {
    const value = (
      await exec('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { timeout: 15000 })
    ).stdout.trim();
    const match =
      /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(
        value,
      );
    if (!match) throw new Error('The origin must be a GitHub repository.');
    return { owner: match[1], name: match[2], full: `${match[1]}/${match[2]}` };
  };
  return {
    git: async (cwd, args) =>
      (
        await exec('git', ['-C', cwd, ...args], {
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          timeout: 120000,
          maxBuffer: 8 * 1024 * 1024,
        })
      ).stdout,
    commit: gitCommit,
    findPR: async (cwd, branch) => {
      const repo = await origin(cwd);
      const rows = JSON.parse(
        await gh(cwd, [
          'pr',
          'list',
          `--repo=${repo.full}`,
          '--state',
          'open',
          `--head=${branch}`,
          '--json',
          'url,headRefName,headRepository,headRepositoryOwner',
          '--limit',
          '100',
        ]),
      );
      if (!Array.isArray(rows)) throw new Error('Invalid PR lookup.');
      const matches = rows.filter(
        (row) =>
          row.headRefName === branch &&
          row.headRepository?.name === repo.name &&
          row.headRepositoryOwner?.login?.toLowerCase() === repo.owner.toLowerCase(),
      );
      if (matches.length > 1) throw new Error('Several pull requests match this branch.');
      return matches[0]?.url;
    },
    createPR: async (cwd, branch, title, body, draft) => {
      const repo = await origin(cwd);
      return (
        await gh(
          cwd,
          [
            'pr',
            'create',
            `--repo=${repo.full}`,
            `--head=${repo.owner}:${branch}`,
            `--title=${title}`,
            ...(draft ? ['--draft'] : []),
            '--body-file',
            '-',
          ],
          body,
        )
      ).trim();
    },
  };
}
interface Saved extends PublishOperation {
  request: PublishRequest;
}
const validID = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
/** The execution host owns the journal and a renewable cross-process checkout lock. */
export class PublishOperations {
  constructor(
    private root: string,
    private effects: PublishEffects,
  ) {}
  private async location(cwd: string) {
    const canonical = await realpath(cwd);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    return { cwd: canonical, key: sha(canonical), file: join(this.root, `${sha(canonical)}.json`) };
  }
  private async records(file: string): Promise<Saved[]> {
    try {
      const text = await readFile(file, 'utf8');
      if (Buffer.byteLength(text) > 1024 * 1024)
        throw new Error('Publish history exceeds its size limit.');
      const rows = JSON.parse(text);
      if (
        !Array.isArray(rows) ||
        rows.some((row) => !validID(row.id) || !row.request || row.id !== row.request.id)
      )
        throw new Error('Invalid publish journal.');
      return rows;
    } catch (error: any) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
  private public(row: Saved): PublishOperation {
    const { request: _request, ...value } = row;
    return structuredClone(value);
  }
  async status(cwd: string, id: string) {
    if (!validID(id)) throw new Error('Invalid publish operation.');
    const location = await this.location(cwd);
    const row = (await this.records(location.file)).find((row) => row.id === id);
    return row ? this.public(row) : null;
  }
  async run(cwd: string, request: PublishRequest): Promise<PublishOperation> {
    if (!request || !validID(request.id)) throw new Error('Invalid publish operation.');
    if (
      request.commit &&
      (typeof request.commit.message !== 'string' ||
        !request.commit.message.trim() ||
        request.commit.message.length > 20000 ||
        /Kalkidan-Operation:/i.test(request.commit.message) ||
        (request.commit.files !== undefined &&
          (!Array.isArray(request.commit.files) ||
            request.commit.files.some((file) => typeof file !== 'string' || !file))))
    )
      throw new Error('Invalid commit request.');
    if (
      request.pullRequest &&
      (typeof request.pullRequest.title !== 'string' ||
        !request.pullRequest.title.trim() ||
        request.pullRequest.title.length > 256 ||
        typeof request.pullRequest.body !== 'string' ||
        request.pullRequest.body.length > 20000 ||
        (request.pullRequest.draft !== undefined && typeof request.pullRequest.draft !== 'boolean'))
    )
      throw new Error('Invalid pull request request.');
    const location = await this.location(cwd);
    return withDirectoryLock(
      this.root,
      async (assertOwned) => {
        const rows = await this.records(location.file);
        let row = rows.find((row) => row.id === request.id);
        const git = (args: string[]) =>
          this.effects.git(location.cwd, args).then((value) => value.trim());
        const branch = await git(['branch', '--show-current']);
        const head = await git(['rev-parse', 'HEAD']).catch(async () => {
          // Only a valid unborn branch has no HEAD. Other Git errors remain failures.
          await git(['symbolic-ref', 'HEAD']);
          const refs = await git(['for-each-ref', '--format=%(objectname)', 'refs/heads']);
          if (refs) throw new Error('Cannot read the checkout HEAD.');
          return '';
        });
        if (!row) {
          if (!request.commit && !request.pullRequest)
            throw new Error('Choose a commit or pull request action.');
          if (
            rows.some((row) =>
              ['committing', 'publishing', 'creating-pr', 'unknown-outcome'].includes(row.phase),
            )
          )
            throw new Error('Reconcile the previous publish operation before starting another.');
          row = {
            id: request.id,
            request: structuredClone(request),
            phase: 'ready',
            branch,
            before: head,
            updatedAt: Date.now(),
          };
          rows.push(row);
        } else if (request.pullRequest && !row.request.pullRequest && row.commit)
          row.request.pullRequest = structuredClone(request.pullRequest);
        const operation = row;
        if (operation.phase === 'completed' && (!operation.request.pullRequest || operation.url))
          return this.public(operation);
        const persist = async () => {
          assertOwned();
          operation.updatedAt = Date.now();
          while (rows.length > 100 || Buffer.byteLength(JSON.stringify(rows)) > 1024 * 1024) {
            const index = rows.findIndex(
              (entry) => entry !== operation && entry.phase === 'completed',
            );
            if (index < 0) throw new Error('Publish history is full.');
            rows.splice(index, 1);
          }
          await writeJSON(location.file, rows);
        };
        const phase = async (next: PublishOperation['phase']) => {
          operation.phase = next;
          operation.error = undefined;
          await persist();
        };
        try {
          if (!branch || branch !== operation.branch) throw new Error('branch_changed');
          if (
            operation.request.pullRequest &&
            branch === (await defaultBranch(location.cwd, this.effects.git))
          )
            throw new Error('default_branch');
          // A receipt lost after git commit can be recovered from its exact operation trailer.
          if (
            !operation.commit &&
            operation.request.commit &&
            ['committing', 'unknown-outcome'].includes(operation.phase)
          ) {
            const marker = `Kalkidan-Operation: ${operation.id}`;
            const body = await git(['log', '-1', '--format=%B']);
            const parent = operation.before
              ? await git(['rev-parse', 'HEAD^'])
              : (await git(['rev-list', '--parents', '-n', '1', 'HEAD']))
                  .split(' ')
                  .slice(1)
                  .join(' ');
            if (body.split('\n').includes(marker) && parent === operation.before) {
              operation.commit = head;
              await phase('committed');
            } else {
              operation.phase = 'unknown-outcome';
              operation.error =
                'The previous commit result is uncertain. Inspect Git history before another commit.';
              await persist();
              return this.public(operation);
            }
          }
          if (operation.commit && head !== operation.commit) throw new Error('head_changed');
          if (!operation.commit && operation.request.commit) {
            if (head !== operation.before) throw new Error('head_changed');
            await phase('committing');
            assertOwned();
            await this.effects.commit(
              location.cwd,
              `${operation.request.commit.message.trim()}\n\nKalkidan-Operation: ${operation.id}`,
              operation.request.commit.files,
            );
            operation.commit = await git(['rev-parse', 'HEAD']);
            await phase('committed');
          }
          if (operation.request.pullRequest && !operation.url) {
            if (!operation.commit && head !== operation.before) throw new Error('head_changed');
            if (operation.phase === 'creating-pr' || operation.phase === 'unknown-outcome') {
              const existing = await this.effects.findPR(location.cwd, branch);
              if (existing) {
                operation.url = this.url(existing);
                await phase('completed');
                return this.public(operation);
              }
              operation.phase = 'unknown-outcome';
              operation.error =
                'The pull request result is uncertain. Check GitHub, then reconcile this operation.';
              await persist();
              return this.public(operation);
            }
            await phase('publishing');
            assertOwned();
            await git(['push', '-u', 'origin', branch]);
            const existing = await this.effects.findPR(location.cwd, branch);
            if (existing) {
              operation.url = this.url(existing);
              await phase('completed');
              return this.public(operation);
            }
            await phase('creating-pr');
            assertOwned();
            operation.url = this.url(
              await this.effects.createPR(
                location.cwd,
                branch,
                operation.request.pullRequest.title,
                operation.request.pullRequest.body,
                operation.request.pullRequest.draft === true,
              ),
            );
          }
          await phase('completed');
        } catch {
          const uncertain = ['committing', 'creating-pr', 'unknown-outcome'].includes(
            operation.phase,
          );
          operation.phase = uncertain
            ? 'unknown-outcome'
            : operation.commit
              ? 'committed'
              : 'failed';
          operation.error = uncertain
            ? 'The result is uncertain. Reconcile before another write.'
            : 'Publish stopped. Check the branch, working files, and GitHub connection, then retry this operation.';
          await persist();
        }
        return this.public(operation);
      },
      location.key,
    );
  }
  private url(value: string) {
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(value))
      throw new Error('Invalid pull request receipt.');
    return value;
  }
}
