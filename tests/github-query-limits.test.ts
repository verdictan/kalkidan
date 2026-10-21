import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { GitHubProjects } from '../electron/github-projects';
import {
  GitHubRequestError,
  GitHubRequestScheduler,
  githubResponse,
} from '../electron/trackers/request-scheduler';
import { backendLoader } from './helpers/backend-loader';

/** GitHub rejects a query that can return more than this many nodes. */
const githubNodeLimit = 500_000;

/**
 * The most nodes that a query can return, as GitHub counts them: each connection adds its
 * page size times the page sizes of the connections that contain it.
 */
function possibleNodes(query: string) {
  let total = 0;
  const stack = [1];
  let pending: number | undefined;
  for (let index = 0; index < query.length; index++) {
    const char = query[index];
    if (char === '(') {
      const close = query.indexOf(')', index);
      const first = /\b(?:first|last):\s*(\d+)/.exec(query.slice(index, close));
      if (first) pending = Number(first[1]);
      index = close;
    } else if (char === '{') {
      const parent = stack.at(-1)!;
      if (pending !== undefined) {
        total += parent * pending;
        stack.push(parent * pending);
      } else stack.push(parent);
      pending = undefined;
    } else if (char === '}') stack.pop();
    else if (!/\s/.test(char)) {
      // A field name between the arguments and the selection ends the connection.
      if (pending !== undefined && /\w/.test(char) && query[index - 1] !== ':') pending = undefined;
    }
  }
  return total;
}

test('the node count follows the GitHub rule', () => {
  assert.equal(possibleNodes('{a(first:10){nodes{b(first:5){nodes{id}}}}}'), 60);
  assert.equal(possibleNodes('{a(first:100){nodes{id}} b(first:3){nodes{id}}}'), 103);
});

test('every board query stays below the GitHub node limit', async () => {
  const queries: string[] = [];
  const service = new GitHubProjects(
    async (query) => {
      queries.push(query);
      return {
        node: {
          viewerCanUpdate: true,
          fields: { nodes: [], pageInfo: { hasNextPage: false } },
          items: {
            nodes: [
              {
                id: 'item',
                content: { __typename: 'Issue', title: 'Task' },
                fieldValues: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'next' } },
              },
            ],
            pageInfo: { hasNextPage: false },
          },
          fieldValues: { nodes: [], pageInfo: { hasNextPage: false } },
        },
      };
    },
    async () => 'fixture',
  );
  await service.board({
    id: 'P',
    title: 'Project',
    url: 'https://github.com/users/test/projects/1',
    owner: 'test',
    number: 1,
  } as any);
  assert.equal(queries.length, 2);
  for (const query of queries) {
    const nodes = possibleNodes(query);
    assert.ok(nodes > 0 && nodes < githubNodeLimit, `${nodes} nodes: ${query.slice(0, 80)}`);
  }
  // The query that GitHub rejected: 100 items × 100 field values × 100 labels.
  const old = queries[0]
    .replace(/items\(first:\d+/, 'items(first:100')
    .replace(/fieldValues\(first:\d+\)/, 'fieldValues(first:100)')
    .replace(/(labels|users|pullRequests|reviewers)\(first:\d+\)/g, '$1(first:100)');
  assert.ok(possibleNodes(old) > githubNodeLimit);
});

test('rejected GraphQL queries get a specific message, not "try again later"', () => {
  const queue = new GitHubRequestScheduler(1, 10, () => 1000);
  const body = (errors: unknown[], data: unknown = undefined) =>
    `HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ data, errors })}`;
  const cases: [unknown[], GitHubRequestError['reason'], RegExp][] = [
    [
      [
        {
          type: 'MAX_NODE_LIMIT_EXCEEDED',
          message: 'By the time this query traverses to the labels connection, it is requesting',
        },
      ],
      'query-limit',
      /too many records/,
    ],
    [
      [
        {
          extensions: { code: 'undefinedField', typeName: 'ProjectV2', fieldName: 'x' },
          message: "Field 'x' doesn't exist on type 'ProjectV2'",
        },
      ],
      'query-invalid',
      /does not agree with the GitHub API/,
    ],
    [
      [{ message: 'No such type ProjectV2Example, so it cannot be a fragment' }],
      'query-invalid',
      /Update Kalkidan/,
    ],
    [
      [
        {
          type: 'INSUFFICIENT_SCOPES',
          message: 'Your token has not been granted the required scopes',
        },
      ],
      'scope',
      /gh auth refresh -s project/,
    ],
  ];
  for (const [errors, reason, message] of cases)
    for (const mutation of [false, true])
      assert.throws(
        () => githubResponse(body(errors), mutation, queue),
        (error: GitHubRequestError) =>
          error.reason === reason &&
          message.test(error.message) &&
          !/try again later/i.test(error.message) &&
          !error.message.includes('traverses'),
        `${reason} ${mutation}`,
      );
  // A server error during execution stays a general failure.
  assert.throws(
    () => githubResponse(body([{ message: 'Something went wrong' }], { node: null }), false, queue),
    (error: GitHubRequestError) => error.reason === 'unavailable',
  );
  // A query limit with partial data from a mutation is still an uncertain write.
  assert.throws(
    () =>
      githubResponse(
        body([{ type: 'MAX_NODE_LIMIT_EXCEEDED' }], { change: { id: 1 } }),
        true,
        queue,
      ),
    (error: GitHubRequestError) => error.reason === 'unknown-outcome',
  );
});

test('the preload removes the Electron IPC prefix from handler errors', async () => {
  let api: any;
  backendLoader({
    electron: {
      contextBridge: { exposeInMainWorld: (_name: string, value: any) => (api = value) },
      ipcRenderer: {
        invoke: async (channel: string) => {
          if (channel === 'tracker-board')
            throw new Error(
              "Error invoking remote method 'tracker-board': Error: GitHub rejected the request.",
            );
          throw new Error('Plain failure');
        },
        on: () => {},
        removeListener: () => {},
      },
    },
  })(resolve('electron', 'preload.ts'));
  await assert.rejects(api.trackerBoard('group', true), (error: Error) => {
    assert.equal(error.message, 'GitHub rejected the request.');
    return true;
  });
  await assert.rejects(api.verdictanStatus(), /^Error: Plain failure$/);
  assert.equal(typeof api.onVerdictanChanged(() => {}), 'function');
});
