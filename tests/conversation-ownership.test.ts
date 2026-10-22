import test from 'node:test';
import assert from 'node:assert/strict';
import {
  conversationOwnership,
  isReadOnly,
  readOnlyDetail,
  readOnlyHelp,
  readOnlyReason,
  remoteOwner,
} from '../src/domain/conversation-ownership';
import { verdictanAccountPageUrl } from '../src/domain/verdictan';

const org = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const otherOrg = '44444444-4444-4444-8444-444444444444';
const otherUser = '55555555-5555-4555-8555-555555555555';
const saved = { organization_id: org, user_id: user };

test('the owner continues its chat, and a chat without a binding is not managed', () => {
  assert.deepEqual(
    conversationOwnership({
      binding: saved,
      account: { organizationId: org.toUpperCase(), userId: user },
    }),
    { state: 'current' },
  );
  assert.deepEqual(
    conversationOwnership({ binding: null, account: { organizationId: org, userId: user } }),
    { state: 'unmanaged' },
  );
  // Without a signed-in account, Kalkidan does not know the owner. The launch still checks.
  assert.deepEqual(conversationOwnership({ binding: saved }), { state: 'unknown' });
  assert.equal(readOnlyReason({ state: 'current' }), '');
});

test('a chat of another account or organization is read-only and says why', () => {
  const organization = conversationOwnership({
    binding: saved,
    account: { organizationId: otherOrg, userId: otherUser },
  });
  assert.deepEqual(organization, { state: 'other', scope: 'organization' });
  assert.equal(
    readOnlyReason(organization),
    'This conversation belongs to another organization. It is read-only.',
  );
  const person = conversationOwnership({
    binding: saved,
    account: { organizationId: org, userId: otherUser },
  });
  assert.deepEqual(person, { state: 'other', scope: 'user' });
  assert.equal(
    readOnlyReason(person),
    'This conversation belongs to another account. It is read-only.',
  );
  assert.match(readOnlyDetail, /context and usage stay with that account/);
});

test('an SSH host answer gives only valid owner IDs', () => {
  assert.equal(remoteOwner(null), null);
  assert.deepEqual(remoteOwner({ organization_id: org, user_id: user, cwd: '/secret' }), saved);
  // A host chat of another organization is read-only, the same as a local chat.
  assert.deepEqual(
    conversationOwnership({
      binding: remoteOwner({ organization_id: otherOrg, user_id: user }),
      account: { organizationId: org, userId: user },
    }),
    { state: 'other', scope: 'organization' },
  );
  for (const value of [
    undefined,
    'owner',
    {},
    { organization_id: org },
    { organization_id: 'x', user_id: user },
  ])
    assert.throws(() => remoteOwner(value), /Invalid conversation owner/);
});

test('account pages open fixed console paths and nothing else', () => {
  const origin = 'https://console.eu.verdictan.com';
  assert.equal(
    verdictanAccountPageUrl(origin, 'verify'),
    'https://console.eu.verdictan.com/verify-email?resend=1',
  );
  assert.equal(
    verdictanAccountPageUrl(origin, 'recover'),
    'https://console.eu.verdictan.com/forgot-password',
  );
  for (const page of ['register', '//evil.example', 'toString', undefined, 1])
    assert.throws(() => verdictanAccountPageUrl(origin, page), /Unknown account page/);
});

test('a chat of the active account whose agent is gone is read-only', () => {
  const account = { organizationId: org, userId: user };
  const agent = '66666666-6666-4666-8666-666666666666';
  const other = '77777777-7777-4777-8777-777777777777';
  const chat = { ...saved, agent_id: agent };
  assert.deepEqual(conversationOwnership({ binding: chat, account, agents: [agent, other] }), {
    state: 'current',
  });
  const gone = conversationOwnership({ binding: chat, account, agents: [other] });
  assert.deepEqual(gone, { state: 'agent_unavailable' });
  assert.equal(isReadOnly(gone), true);
  assert.match(readOnlyReason(gone), /agent is no longer available/);
  assert.match(readOnlyHelp(gone), /Fork the chat/);
  // A chat from an older version uses the agent of its coding agent.
  assert.deepEqual(
    conversationOwnership({ binding: saved, account, agents: [other], legacyAgent: agent }),
    { state: 'agent_unavailable' },
  );
  // Without the agent list, or without an agent, the chat stays usable.
  assert.deepEqual(conversationOwnership({ binding: chat, account }), { state: 'current' });
  assert.deepEqual(conversationOwnership({ binding: saved, account, agents: [other] }), {
    state: 'current',
  });
  // The agent of another account does not matter. That chat is read-only for its owner.
  assert.equal(
    conversationOwnership({
      binding: { ...chat, user_id: otherUser },
      account,
      agents: [other],
    }).state,
    'other',
  );
  // The host sends the agent ID. A value that is not an ID is refused.
  assert.deepEqual(remoteOwner(chat), chat);
  assert.throws(() => remoteOwner({ ...saved, agent_id: '../x' }), /Invalid conversation owner/);
  assert.equal(readOnlyHelp({ state: 'other', scope: 'user' }), readOnlyDetail);
});
