import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import schema from '../src/config/github-projects-rest.json';
import { githubResponse, GitHubRequestScheduler } from '../electron/trackers/request-scheduler';
test('pinned REST contracts include all resolved Projects references and an intact digest', () => {
  const { sha256, ...body } = schema;
  assert.equal(createHash('sha256').update(JSON.stringify(body)).digest('hex'), sha256);
  assert.equal(Object.keys(schema.paths).length, 18);
  const visit = (value: any) => {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      const [, , kind, name] = value.$ref.split('/');
      assert.ok((schema.components as any)[kind]?.[name], value.$ref);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(schema);
});
test('REST transport retains pagination and shares authentication and cooldown errors', () => {
  const scheduler = new GitHubRequestScheduler();
  const link = '<https://api.github.com/orgs/org/projectsV2/1/items?after=next>; rel="next"';
  assert.deepEqual(
    githubResponse(`HTTP/2.0 200 OK\r\nLink: ${link}\r\n\r\n[]`, false, scheduler, 100, true),
    { body: [], link },
  );
  assert.throws(
    () => githubResponse('HTTP/2.0 401 Unauthorized\r\n\r\n{}', false, scheduler, 100, true),
    /authentication/,
  );
  assert.throws(
    () =>
      githubResponse(
        'HTTP/2.0 429 Limited\r\nRetry-After: 10\r\n\r\n{}',
        false,
        scheduler,
        100,
        true,
      ),
    /limiting/,
  );
});

test('partial mutation responses are uncertain, never confirmed rejections', () => {
  assert.throws(
    () =>
      githubResponse(
        JSON.stringify({
          data: { updateProjectV2: { projectV2: { id: 'P' } } },
          errors: [{ type: 'FORBIDDEN' }],
        }),
        true,
        new GitHubRequestScheduler(),
      ),
    (error: any) => error.reason === 'unknown-outcome',
  );
  assert.throws(
    () =>
      githubResponse(
        JSON.stringify({ data: { updateProjectV2: null } }),
        true,
        new GitHubRequestScheduler(),
      ),
    (error: any) => error.reason === 'unknown-outcome',
  );
});
