import assert from 'node:assert/strict';
import { test } from 'node:test';
import { otherRegion, suggestRegion, urlHost } from '../src/lib/region-suggestion';
import { initials } from '../src/components/account-menu';

test('suggests the EU for Europe, Africa and Asia, and the US for the Americas', () => {
  assert.equal(suggestRegion('Europe/Berlin'), 'eu');
  assert.equal(suggestRegion('Africa/Lagos'), 'eu');
  assert.equal(suggestRegion('Asia/Tokyo'), 'eu');
  assert.equal(suggestRegion('America/New_York'), 'us');
  assert.equal(suggestRegion('America/Sao_Paulo'), 'us');
  assert.equal(suggestRegion('US/Pacific'), 'us');
});

test('gives no suggestion for other time zones', () => {
  for (const zone of ['UTC', 'Etc/GMT', 'Pacific/Auckland', 'Australia/Sydney', '', 'Europe'])
    assert.equal(suggestRegion(zone), undefined, zone);
});

test('other region and URL host', () => {
  assert.equal(otherRegion('eu'), 'us');
  assert.equal(otherRegion('us'), 'eu');
  assert.equal(
    urlHost('https://console.eu.verdictan.com/auth/cli?x=1'),
    'console.eu.verdictan.com',
  );
  assert.equal(urlHost('not a url'), '');
  assert.equal(urlHost(undefined), '');
});

test('avatar initials', () => {
  assert.equal(initials('Dana Kim'), 'DK');
  assert.equal(initials('dana.kim@acme.dev'), 'DK');
  assert.equal(initials('dana@acme.dev'), 'DA');
  assert.equal(initials(''), '');
  assert.equal(initials(undefined), '');
});
