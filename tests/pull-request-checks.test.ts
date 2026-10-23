import test from 'node:test';
import assert from 'node:assert/strict';
import { pullRequestChecks } from '../electron/git-working';

test('pull request checks give one result for the status check rollup', () => {
  const run = (status: string, conclusion = '') => ({ __typename: 'CheckRun', status, conclusion });
  const context = (state: string) => ({ __typename: 'StatusContext', state });
  assert.equal(pullRequestChecks(undefined), undefined);
  assert.equal(pullRequestChecks([]), undefined);
  assert.equal(pullRequestChecks([null, 'x']), undefined);
  assert.equal(pullRequestChecks([run('COMPLETED', 'SUCCESS'), context('SUCCESS')]), 'pass');
  // Skipped and neutral checks do not fail the pull request.
  assert.equal(
    pullRequestChecks([run('COMPLETED', 'SKIPPED'), run('COMPLETED', 'NEUTRAL')]),
    'pass',
  );
  assert.equal(pullRequestChecks([run('COMPLETED', 'SUCCESS'), run('IN_PROGRESS')]), 'pending');
  assert.equal(pullRequestChecks([run('QUEUED'), context('PENDING')]), 'pending');
  assert.equal(pullRequestChecks([context('EXPECTED')]), 'pending');
  // A failure wins over a check that did not finish.
  assert.equal(pullRequestChecks([run('IN_PROGRESS'), run('COMPLETED', 'FAILURE')]), 'fail');
  assert.equal(pullRequestChecks([context('ERROR')]), 'fail');
  assert.equal(pullRequestChecks([run('COMPLETED', 'TIMED_OUT')]), 'fail');
  assert.equal(pullRequestChecks([run('COMPLETED', 'CANCELLED')]), 'fail');
});
