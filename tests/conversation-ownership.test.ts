import test from 'node:test';
import assert from 'node:assert/strict';
import {
  conversationOwnership,
  readOnlyDetail,
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
