import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dataDirectory } from '../electron/storage/data-directory';

test('moves the complete legacy profile, removes the old location, and preserves an existing destination', () => {
  const home = mkdtempSync(join(tmpdir(), 'kalkidan-storage-'));
  try {
    const appData = join(home, 'Application Support');
    const legacy = join(appData, 'common-ground');
    mkdirSync(join(legacy, 'Local Storage'), { recursive: true });
    writeFileSync(join(legacy, 'projects.json'), '["saved"]');
    writeFileSync(join(legacy, 'Local Storage', 'state'), 'browser-state');
    const destination = dataDirectory(home, appData);
    assert.equal(destination, join(home, '.kalkidan'));
    assert.equal(existsSync(legacy), false);
    assert.equal(readFileSync(join(destination, 'projects.json'), 'utf8'), '["saved"]');
    assert.equal(
      readFileSync(join(destination, 'Local Storage', 'state'), 'utf8'),
      'browser-state',
    );
    mkdirSync(legacy);
    writeFileSync(join(legacy, 'projects.json'), '["other"]');
    assert.equal(dataDirectory(home, appData), destination);
    assert.equal(readFileSync(join(legacy, 'projects.json'), 'utf8'), '["other"]');
    const isolated = join(home, 'test-profile');
    assert.equal(dataDirectory(home, appData, isolated), isolated);
    assert.equal(existsSync(join(isolated, 'projects.json')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('creates a hidden storage directory for a fresh install', () => {
  const home = mkdtempSync(join(tmpdir(), 'kalkidan-fresh-'));
  try {
    assert.equal(dataDirectory(home, join(home, 'appData')), join(home, '.kalkidan'));
    assert.ok(existsSync(join(home, '.kalkidan')));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('does not resolve legacy OS paths for an existing or isolated profile', () => {
  const home = mkdtempSync(join(tmpdir(), 'kalkidan-existing-'));
  try {
    const unavailablePath = () => {
      throw new Error('OS profile is unavailable');
    };
    mkdirSync(join(home, '.kalkidan'));
    assert.equal(dataDirectory(home, unavailablePath), join(home, '.kalkidan'));
    const isolated = join(home, 'isolated');
    assert.equal(dataDirectory(home, unavailablePath, isolated), isolated);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
