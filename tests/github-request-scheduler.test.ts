import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GitHubRequestScheduler,
  GitHubRequestError,
  githubResponse,
} from '../electron/trackers/request-scheduler';

async function drain() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
test('GitHub requests share bounded slots and rate limits drain queued work without replay', async () => {
  let now = 1000;
  const queue = new GitHubRequestScheduler(2, 1, () => now);
  const finish: (() => void)[] = [];
  let starts = 0;
  const work = () => {
    starts++;
    return new Promise<void>((done) => finish.push(done));
  };
  const a = queue.run(work);
  const b = queue.run(work);
  const c = queue.run(work);
  const rejected = assert.rejects(
    c,
    (error: GitHubRequestError) => error.reason === 'rate-limit' && error.retryAt === 5000,
  );
  await assert.rejects(queue.run(work), /could not complete/);
  await drain();
  assert.equal(starts, 2);
  queue.deferUntil(5000);
  await rejected;
  await assert.rejects(queue.run(work), /limiting/);
  finish.forEach((done) => done());
  await Promise.all([a, b]);
  await drain();
  assert.equal(starts, 2);
  now = 5001;
  assert.equal(await queue.run(async () => 'resumed'), 'resumed');
  await assert.rejects(
    queue.run(async () => {
      throw Error('unknown write outcome');
    }),
    /unknown/,
  );
  assert.equal(await queue.run(async () => 'next'), 'next');
  assert.throws(() => new GitHubRequestScheduler(0), /limits/);
});
test('GitHub queue releases a slot on success and failure', async () => {
  const queue = new GitHubRequestScheduler(1);
  let finish!: () => void;
  const a = queue.run(
    () =>
      new Promise<void>((done) => {
        finish = done;
      }),
  );
  const b = queue.run(async () => 'queued');
  await drain();
  finish();
  await a;
  assert.equal(await b, 'queued');
});
test('GitHub response parser classifies limits, auth, and uncertain writes without private text', async () => {
  const queue = new GitHubRequestScheduler(1, 10, () => 1000);
  const response = (status: number, headers = '', body = '{"data":{"ok":true}}') =>
    `HTTP/2.0 ${status} Status\r\nContent-Type: application/json\r\n${headers}\r\n${body}`;
  assert.deepEqual(githubResponse(response(200), false, queue), { ok: true });
  assert.deepEqual(githubResponse('{"data":{"ok":true}}', false, queue), { ok: true });
  for (const [status, reason] of [
    [401, 'signed-out'],
    [403, 'permission'],
    [404, 'permission'],
    [500, 'unavailable'],
  ] as const) {
    assert.throws(
      () => githubResponse(response(status), false, queue),
      (error: GitHubRequestError) => error.reason === reason,
    );
  }
  for (const body of ['not json', '{"errors":[{"message":"PRIVATE"}]}']) {
    assert.throws(
      () => githubResponse(response(200, '', body), true, queue),
      (error: GitHubRequestError) =>
        error.reason === 'unknown-outcome' && !error.message.includes('PRIVATE'),
    );
  }
  assert.throws(
    () => githubResponse(response(503), true, queue),
    (error: GitHubRequestError) => error.reason === 'unknown-outcome',
  );
  for (const body of ['null', '{}', 'false', '{']) {
    assert.throws(
      () => githubResponse(body, false, queue),
      (error: GitHubRequestError) => error.reason === 'invalid-response',
    );
  }
  assert.throws(
    () => githubResponse(response(403, 'Retry-After: 2\r\n'), false, queue, 1000),
    (error: GitHubRequestError) => error.retryAt === 3000,
  );
  await assert.rejects(
    queue.run(async () => 'not started'),
    /limiting/,
  );
  assert.throws(
    () =>
      githubResponse(
        response(403, 'X-RateLimit-Remaining: 0\r\nX-RateLimit-Reset: 20\r\n'),
        false,
        queue,
        1000,
      ),
    (error: GitHubRequestError) => error.retryAt === 20000,
  );
  assert.throws(
    () => githubResponse(response(429, 'Retry-After: nonsense\r\n'), false, queue, 1000),
    (error: GitHubRequestError) => error.retryAt === 61000,
  );
  assert.throws(
    () => githubResponse('{"errors":[{"type":"RATE_LIMITED"}]}', false, queue, 1000),
    (error: GitHubRequestError) => error.reason === 'rate-limit',
  );
  assert.throws(
    () => githubResponse('{"errors":[{"type":"FORBIDDEN"}]}', false, queue),
    (error: GitHubRequestError) => error.reason === 'permission',
  );
});
