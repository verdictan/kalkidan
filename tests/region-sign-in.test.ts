import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  managedErrorInfo,
  managedLaunchBlock,
  managedRefusal,
  managedSetupStep,
  managedSetupTargets,
} from '../src/domain/verdictan';

const code = 'desktop.region_required';

test('a missing region asks for the region only when no region is saved', () => {
  assert.match(managedErrorInfo(code).message, /region/);
  assert.equal(managedErrorInfo(code).signIn, undefined);
  assert.equal(managedSetupStep('region'), 'region');
  assert.equal(managedLaunchBlock(new Error(code)).step, 'region');
  assert.equal(managedSetupTargets[managedSetupStep('region')].label, 'Select the region');
});

test('with a saved region, the fix is a sign-in', () => {
  const saved = { regionSaved: true };
  assert.deepEqual(managedErrorInfo(code, saved), {
    message: 'Sign in to Verdictan to start chats.',
    section: 'account',
    signIn: true,
  });
  assert.equal(managedSetupStep('region', saved), 'sign-in');
  assert.equal(managedSetupStep('runtime', saved), 'runtime');
  const block = managedLaunchBlock(new Error(`Select the region. [${code}]`), saved);
  assert.equal(block.step, 'sign-in');
  assert.match(block.message, /Sign in to Verdictan to start chats\.$/);
  assert.doesNotMatch(block.message, /region/i);
  const refusal = managedRefusal(code, saved);
  assert.equal(refusal.step, 'sign-in');
  assert.equal(refusal.message, 'Sign in to Verdictan to start chats.');
  // Other codes do not change.
  assert.deepEqual(
    managedErrorInfo('desktop.runtime_missing', saved),
    managedErrorInfo('desktop.runtime_missing'),
  );
});
