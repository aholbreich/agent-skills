'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const script = path.join(repoRoot, 'skills/jira-browser-fetch/scripts/jira-browser-fetch.js');
const lib = require('../skills/jira-browser-fetch/scripts/lib');

test('jira parseSize supports bytes and binary units', () => {
  assert.equal(lib.parseSize(), 5 * 1024 * 1024);
  assert.equal(lib.parseSize(''), 5 * 1024 * 1024);
  assert.equal(lib.parseSize('5mb'), 5 * 1024 * 1024);
  assert.equal(lib.parseSize('1.5mb'), Math.floor(1.5 * 1024 * 1024));
  assert.equal(lib.parseSize('500kb'), 500 * 1024);
  assert.equal(lib.parseSize('42'), 42);
  assert.equal(lib.parseSize('unlimited'), Infinity);
  assert.throws(() => lib.parseSize('ten megabytes'), /Invalid size/);
});

test('jira formatBytes formats human-readable sizes', () => {
  assert.equal(lib.formatBytes(42), '42 B');
  assert.equal(lib.formatBytes(1024), '1.0 KiB');
  assert.equal(lib.formatBytes(1024 * 1024), '1.0 MiB');
  assert.equal(lib.formatBytes(Infinity), 'unlimited');
});

test('jira safeName sanitizes unsafe filenames', () => {
  assert.equal(lib.safeName('foo/bar\\baz.png'), 'foo_bar_baz.png');
  assert.equal(lib.safeName('..'), '_');
  assert.equal(lib.safeName(''), 'attachment');
});

test('jira issueKeysFromText extracts unique issue keys', () => {
  assert.deepEqual(
    lib.issueKeysFromText('See SWING-4770, SSD-24061, and SWING-4770 again. Ignore abc-1.'),
    ['SWING-4770', 'SSD-24061']
  );
});

test('jira shouldSkipAttachment honors size threshold', () => {
  assert.equal(lib.shouldSkipAttachment(6 * 1024 * 1024, lib.parseSize('5mb')), true);
  assert.equal(lib.shouldSkipAttachment(5 * 1024 * 1024, lib.parseSize('5mb')), false);
  assert.equal(lib.shouldSkipAttachment('not-a-number', lib.parseSize('5mb')), false);
  assert.equal(lib.shouldSkipAttachment(999999999, Infinity), false);
});

test('jira CLI --help exits successfully without browser', () => {
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: jira-browser-fetch/);
});

test('jira CLI fails fast when server is missing', () => {
  const result = spawnSync(process.execPath, [script, 'PROJ-123'], {
    encoding: 'utf8',
    env: { ...process.env, JIRA_SERVER: '' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Missing Jira server/);
});
