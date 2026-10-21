import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activitySnapshot,
  chatStatusInfo,
  markDraftOutcome,
  markFinished,
  markSeen,
} from '../src/components/activity-dot';

const at = '2026-10-01T10:00:00.000Z';

test('the row status reads the saved outcome, then the draft outcome in memory', () => {
  const store = {
    finished: [{ agent: 'codex', id: 'saved', at }],
    drafts: {
      'codex:draft-1': { outcome: 'refused' as const, reason: 'desktop.auth_required', at },
    },
  };
  assert.deepEqual(chatStatusInfo({ agent: 'codex', id: 'saved' }, undefined, store), {
    state: 'done',
  });
  const saved = chatStatusInfo(
    { agent: 'codex', id: 'saved', outcome: { outcome: 'failed', reason: 'timeout', at } },
    undefined,
    store,
  );
  assert.equal(saved?.state, 'failed');
  assert.equal(saved?.label, 'The last run failed. The agent did not respond in time.');
  const draft = chatStatusInfo({ agent: 'codex', id: 'draft-1' }, undefined, store);
  assert.equal(draft?.state, 'refused');
  assert.match(draft?.label || '', /Sign in to managed agents/);
  assert.deepEqual(chatStatusInfo({ agent: 'codex', id: 'draft-1' }, 'running', store), {
    state: 'running',
  });
});

test('opening a chat removes only the finished mark, not a failed outcome', () => {
  const chat = { agent: 'codex', id: 'draft-2' };
  markFinished(chat.agent, chat.id);
  assert.equal(chatStatusInfo(chat, undefined, activitySnapshot())?.state, 'done');
  markDraftOutcome(chat.agent, chat.id, { outcome: 'failed', reason: 'agent_error', at });
  assert.equal(chatStatusInfo(chat, undefined, activitySnapshot())?.state, 'failed');
  markSeen(chat.agent, chat.id);
  assert.equal(activitySnapshot().finished.length, 0);
  assert.equal(chatStatusInfo(chat, undefined, activitySnapshot())?.state, 'failed');
  // A run that saves the draft removes its outcome from memory.
  markDraftOutcome(chat.agent, chat.id, undefined);
  assert.equal(chatStatusInfo(chat, undefined, activitySnapshot()), undefined);
  const before = activitySnapshot();
  markDraftOutcome(chat.agent, chat.id, undefined);
  assert.equal(activitySnapshot(), before);
});
