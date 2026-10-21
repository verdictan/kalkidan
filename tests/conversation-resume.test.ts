import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  accessResumeFields,
  decideConversationResume,
  sessionResumeFields,
  sharedResumeFields,
  type ResumeDecision,
} from '../src/domain/conversation-resume';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/verdictan/${name}`, import.meta.url), 'utf8'));
const shared = ({ guidance: _guidance, ...result }: ResumeDecision) => result;

/** The shared contract fixture from Verdictan `cli/docs/contracts/fixtures`. */
const saved = Object.freeze({
  schema_version: 1 as const,
  organization_id: id,
  user_id: id,
  region_id: id,
  provider_connection_id: id,
  installation_id: id,
  host_id: id,
  conversation_id: id,
  provider: 'openai',
  model: 'fixture-model',
  agent_kind: 'codex' as const,
  agent_version: '0.163.0-alpha.10.2',
  context_format_version: 1,
});
/** A Kalkidan binding as `electron/verdictan/launch.ts` writes it. */
const session = Object.freeze({
  ...saved,
  configuration_id: id,
  configuration_version_id: id,
  cwd: '/work/project',
});

// Ported from Verdictan `cli/src/auth/desktop-resume.test.ts`.
test('same bindings remain compatible but require current authorization and policy', () => {
  const result = decideConversationResume(saved, {
    ...saved,
    future_field: true,
    policy_version_id: 'current-policy',
  });
  assert.deepEqual(result, {
    schema_version: 1,
    status: 'compatible',
    code: null,
    mismatched_fields: [],
    recovery_action: 'check_gateway_and_current_policy',
    dispatch_allowed: false,
    requires_gateway_readiness: true,
    requires_current_policy_evaluation: true,
    transfer_authorized: false,
    guidance: 'none',
  });
});

for (const [field, value] of Object.entries({
  organization_id: other,
  user_id: other,
  region_id: other,
  provider_connection_id: other,
  installation_id: other,
  host_id: other,
  conversation_id: other,
  provider: 'anthropic',
  model: 'changed-model',
  agent_kind: 'claude_code',
  agent_version: '0.164.0',
  context_format_version: 2,
}))
  test(`blocks changed ${field} without mutating context or authorizing transfer`, () => {
    const requested = Object.freeze({ ...saved, [field]: value });
    const result = decideConversationResume(saved, requested);
    assert.equal(result.status, 'incompatible');
    assert.equal(result.code, 'desktop.resume_incompatible');
    assert.deepEqual(result.mismatched_fields, [field]);
    assert.equal(result.recovery_action, 'explicit_reauthorization_and_context_transfer');
    assert.equal(result.dispatch_allowed, false);
    assert.equal(result.transfer_authorized, false);
    assert.equal(saved.model, 'fixture-model');
    assert.equal(requested[field as keyof typeof requested], value);
  });

test('missing or malformed identities and unsupported schema versions fail closed without echoing data', () => {
  for (const input of [
    null,
    undefined,
    [],
    'binding',
    {},
    { ...saved, schema_version: 2 },
    { ...saved, organization_id: 'DO_NOT_EXPORT' },
    { ...saved, model: '/secret/path' },
    { ...saved, context_format_version: 0 },
    { ...saved, context_format_version: 1.5 },
    { ...saved, provider: 'Upper' },
    { ...saved, agent_kind: 'shell' },
    { ...saved, agent_version: 'latest' },
  ]) {
    for (const result of [
      decideConversationResume(saved, input),
      decideConversationResume(input, saved),
    ]) {
      assert.equal(result.status, 'invalid');
      assert.equal(result.code, 'desktop.resume_binding_invalid');
      assert.deepEqual(result.mismatched_fields, []);
      assert.equal(result.guidance, 'new_authorized_session');
      assert.doesNotMatch(JSON.stringify(result), /DO_NOT_EXPORT|secret/);
      assert.equal(result.dispatch_allowed, false);
    }
  }
});

test('matches the shared resume fixture for identical bound context', () => {
  const [input] = fixture('desktop-conversation-binding.json');
  const [compatible, incompatible] = fixture('desktop-resume-result.json');
  assert.deepEqual(shared(decideConversationResume(input, input)), compatible);
  assert.deepEqual(
    shared(decideConversationResume(input, { ...input, organization_id: other })),
    incompatible,
  );
});

test('the decision uses only the field names and outcomes of the shared contract schemas', () => {
  const binding = fixture('desktop-conversation-binding.v1.schema.json');
  const result = fixture('desktop-resume-result.v1.schema.json');
  assert.deepEqual(
    [...sharedResumeFields],
    binding.required.filter((key: string) => key !== 'schema_version'),
  );
  assert.deepEqual([...sharedResumeFields], result.properties.mismatched_fields.items.enum);
  assert.deepEqual(
    Object.keys(shared(decideConversationResume(saved, saved))).sort(),
    [...result.required].sort(),
  );
  assert.deepEqual(result.properties.recovery_action.enum, [
    'check_gateway_and_current_policy',
    'explicit_reauthorization_and_context_transfer',
  ]);
});

test('identifiers compare without case, other fields compare exactly', () => {
  assert.equal(
    decideConversationResume(saved, { ...saved, organization_id: id.toUpperCase() }).status,
    'compatible',
  );
  assert.deepEqual(
    decideConversationResume(saved, { ...saved, model: 'Fixture-Model' }).mismatched_fields,
    ['model'],
  );
});

test('a fork can change the conversation but no other binding field', () => {
  assert.equal(
    decideConversationResume(session, { ...session, conversation_id: other }, { fork: true })
      .status,
    'compatible',
  );
  assert.deepEqual(
    decideConversationResume(
      session,
      { ...session, conversation_id: other, model: 'other' },
      { fork: true },
    ).mismatched_fields,
    ['model'],
  );
});

test('Kalkidan session fields are frozen, and a saved governance scope cannot change', () => {
  for (const [patch, field] of [
    [{ configuration_id: other }, 'configuration_id'],
    [{ configuration_version_id: other }, 'configuration_version_id'],
    [{ cwd: '/elsewhere' }, 'cwd'],
    [{ project_id: 'project-1' }, 'project_id'],
    [{ task_id: 'task-1' }, 'task_id'],
  ] as const) {
    assert.deepEqual(
      decideConversationResume({ ...session, ...patch }, session).mismatched_fields,
      [field],
    );
    assert.deepEqual(
      decideConversationResume({ ...session, ...patch }, { ...session, [field]: 'changed-2' })
        .mismatched_fields,
      [field],
    );
  }
  for (const [patch, field] of [
    [{ configuration_id: other }, 'configuration_id'],
    [{ configuration_version_id: other }, 'configuration_version_id'],
    [{ cwd: '/elsewhere' }, 'cwd'],
  ] as const)
    assert.deepEqual(
      decideConversationResume(session, { ...session, ...patch }).mismatched_fields,
      [field],
    );
  // A conversation without a saved scope can get one when its project becomes managed.
  assert.equal(
    decideConversationResume(session, { ...session, project_id: 'project-1', task_id: 'task-1' })
      .status,
    'compatible',
  );
  for (const patch of [
    { project_id: '-bad' },
    { task_id: '' },
    { cwd: '' },
    { configuration_id: 1 },
    { provider_access_mode: 'free' },
  ])
    assert.equal(decideConversationResume(session, { ...session, ...patch }).status, 'invalid');
});

test('a provider access mode change needs a new authorized session', () => {
  const claude = {
    ...session,
    provider: 'anthropic',
    agent_kind: 'claude_code' as const,
    provider_connection_id: '',
    provider_access_mode: 'claude_subscription' as const,
  };
  assert.equal(decideConversationResume(claude, claude).status, 'compatible');
  // An absent mode is BYOK, so an explicit BYOK value is the same mode.
  assert.equal(
    decideConversationResume(session, { ...session, provider_access_mode: 'byok' }).status,
    'compatible',
  );
  const byok = { ...claude, provider_connection_id: id, provider_access_mode: undefined };
  const result = decideConversationResume(claude, byok);
  assert.equal(result.status, 'incompatible');
  assert.deepEqual(result.mismatched_fields, ['provider_connection_id', 'provider_access_mode']);
  assert.equal(result.guidance, 'new_authorized_session');
  // Only subscription modes can omit the provider connection.
  assert.equal(
    decideConversationResume(session, { ...session, provider_connection_id: '' }).status,
    'invalid',
  );
});

test('guidance separates access changes from native context changes', () => {
  for (const field of accessResumeFields) {
    assert.ok(
      [...sharedResumeFields, ...sessionResumeFields].includes(field as never),
      `${field} is a compared field`,
    );
  }
  for (const patch of [
    { organization_id: other },
    { user_id: other },
    { region_id: other },
    { installation_id: other },
    { host_id: other },
    { provider: 'other' },
    { provider_access_mode: 'codex_subscription', provider_connection_id: '' },
    { model: 'other', user_id: other },
  ])
    assert.equal(
      decideConversationResume(session, { ...session, ...patch }).guidance,
      'new_authorized_session',
      JSON.stringify(patch),
    );
  for (const patch of [
    { model: 'other' },
    { agent_version: '0.164.0' },
    { context_format_version: 2 },
    { agent_kind: 'claude_code' },
    { conversation_id: other },
    { configuration_version_id: other },
    { cwd: '/elsewhere' },
  ]) {
    const result = decideConversationResume(session, { ...session, ...patch });
    assert.equal(result.guidance, 'explicit_context_transfer', JSON.stringify(patch));
    assert.equal(result.transfer_authorized, false);
  }
});

test('the decision does not change its inputs', () => {
  const previous = structuredClone(session);
  const requested = { ...structuredClone(session), model: 'other' };
  const copy = structuredClone(requested);
  decideConversationResume(previous, requested);
  assert.deepEqual(previous, session);
  assert.deepEqual(requested, copy);
});
