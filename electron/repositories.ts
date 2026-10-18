import { mkdir } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { exec } from './core';
import { githubExecutable } from './github-projects';
import type { GitHubRepository } from '../src/types';
export function repositoryName(value: string) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(value) ||
    ['.', '..'].includes(value.split('/')[1])
  )
    throw new Error('Choose a GitHub repository or enter owner/repository.');
  return value;
}
export async function listRepositories(
  run = exec,
  executable = githubExecutable,
): Promise<GitHubRepository[]> {
  const gh = await executable();
  let stdout: string;
  try {
    // /user/repos includes organization and team access omitted by viewer.repositories.
    // Let gh follow Link headers rather than imposing a repository limit.
    ({ stdout } = await run(
      gh,
      [
        'api',
        '--hostname',
        'github.com',
        '--paginate',
        '--slurp',
        'user/repos?visibility=all&affiliation=owner,collaborator,organization_member&sort=full_name&direction=asc&per_page=100',
      ],
      { timeout: 120000, maxBuffer: 64 * 1024 * 1024 },
    ));
  } catch (error: any) {
    if (error.code === 'ENOENT')
      throw new Error('Install GitHub CLI, then connect GitHub to load repositories.');
    throw new Error(
      'Could not load all GitHub repositories. Check your connection and authorize GitHub access, including any required organization SSO, then refresh.',
    );
  }
  const pages = JSON.parse(stdout);
  if (!Array.isArray(pages) || !pages.every(Array.isArray))
    throw new Error('GitHub returned an invalid repository list. Refresh to try again.');
  const repositories = new Map<string, GitHubRepository>();
  for (const row of pages.flat()) {
    if (typeof row.full_name !== 'string' || typeof row.private !== 'boolean')
      throw new Error('GitHub returned incomplete repository data. Refresh to try again.');
    repositories.set(row.full_name.toLowerCase(), {
      nameWithOwner: row.full_name,
      description: row.description || null,
      isPrivate: row.private,
      isArchived: !!row.archived,
    });
  }
  return [...repositories.values()].sort((a, b) => a.nameWithOwner.localeCompare(b.nameWithOwner));
}
export async function cloneRepository(
  name: string,
  destination: string,
  run = exec,
  executable = githubExecutable,
) {
  repositoryName(name);
  if (typeof destination !== 'string' || !isAbsolute(destination))
    throw new Error('Choose a local destination.');
  const gh = await executable();
  // Reserve a new directory exclusively: never clone into or overwrite an existing folder.
  try {
    await mkdir(destination);
  } catch (error: any) {
    if (error.code === 'EEXIST')
      throw new Error(
        'That folder already exists. Choose a new folder name, or add it as a local repository.',
      );
    throw error;
  }
  try {
    await run(gh, ['repo', 'clone', `https://github.com/${name}`, destination], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: '1',
        GIT_TERMINAL_PROMPT: '0',
        GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
      },
    });
  } catch {
    throw new Error(
      `Could not finish cloning ${name}. Check GitHub access and your network. Any downloaded files remain at ${destination}; choose another destination to retry, or add that folder if the clone completed.`,
    );
  }
}
