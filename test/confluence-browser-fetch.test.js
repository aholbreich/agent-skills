'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const script = path.join(repoRoot, 'skills/confluence-browser-fetch/scripts/confluence-browser-fetch.js');
const lib = require('../skills/confluence-browser-fetch/scripts/lib');

test('confluence parseSize supports bytes and binary units', () => {
  assert.equal(lib.parseSize(), 5 * 1024 * 1024);
  assert.equal(lib.parseSize('5mb'), 5 * 1024 * 1024);
  assert.equal(lib.parseSize('2gib'), 2 * 1024 ** 3);
  assert.equal(lib.parseSize('250 k'), 250 * 1024);
  assert.equal(lib.parseSize('unlimited'), Infinity);
  assert.throws(() => lib.parseSize('large'), /Invalid size/);
});

test('confluence slugify produces stable path segments', () => {
  assert.equal(lib.slugify('Kundenliste für Start Example.KIM Konfiguration'), 'Kundenliste-fur-Start-Example.KIM-Konfiguration');
  assert.equal(lib.slugify('  RFC012:  Production Logging Standards  '), 'RFC012-Production-Logging-Standards');
  assert.equal(lib.slugify(''), 'untitled');
});

test('confluence safeName sanitizes unsafe filenames', () => {
  assert.equal(lib.safeName('a/b\\c.docx'), 'a_b_c.docx');
  assert.equal(lib.safeName('..'), '_');
  assert.equal(lib.safeName(null), 'attachment');
});

test('confluence extractPageId supports common URL shapes', () => {
  assert.equal(lib.extractPageId('123456'), '123456');
  assert.equal(
    lib.extractPageId('https://example.atlassian.net/wiki/spaces/ABC/pages/123456/Page+Title'),
    '123456'
  );
  assert.equal(
    lib.extractPageId('https://example.atlassian.net/wiki/pages/viewpage.action?pageId=987654'),
    '987654'
  );
  assert.equal(
    lib.extractPageId('https://example.atlassian.net/wiki/spaces/ABC/overview?homepageId=173015042'),
    '173015042'
  );
  assert.equal(lib.extractPageId('not a url'), null);
});

test('confluence sameVersion compares id, status, number and timestamp', () => {
  const existing = { id: '1', status: 'current', version: { number: 3, when: '2026-01-01T00:00:00Z' } };
  const same = { id: '1', status: 'current', version: { number: 3, when: '2026-01-01T00:00:00Z' } };
  const newer = { id: '1', status: 'current', version: { number: 4, when: '2026-01-02T00:00:00Z' } };
  const differentStatus = { id: '1', status: 'archived', version: { number: 3, when: '2026-01-01T00:00:00Z' } };
  assert.equal(lib.sameVersion(existing, same), true);
  assert.equal(lib.sameVersion(existing, newer), false);
  assert.equal(lib.sameVersion(existing, differentStatus), false);
  assert.equal(lib.sameVersion(null, same), false);
});

test('confluence shouldSkipAttachment honors size threshold', () => {
  assert.equal(lib.shouldSkipAttachment(6 * 1024 * 1024, lib.parseSize('5mb')), true);
  assert.equal(lib.shouldSkipAttachment(5 * 1024 * 1024, lib.parseSize('5mb')), false);
  assert.equal(lib.shouldSkipAttachment(undefined, lib.parseSize('5mb')), false);
  assert.equal(lib.shouldSkipAttachment(999999999, Infinity), false);
});

test('confluence CLI --help exits successfully without browser', () => {
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: confluence-browser-fetch/);
});

test('confluence CLI fails fast when site is missing', () => {
  const result = spawnSync(process.execPath, [script, '123456'], {
    encoding: 'utf8',
    env: { ...process.env, CONFLUENCE_SITE: '' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Missing Atlassian site/);
});

test('confluence-browser-fetch --help advertises unified defaults', () => {
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /9223/);
  assert.match(result.stdout, /atlassian-browser-chrome/);
  assert.doesNotMatch(result.stdout, /9224|confluence-browser-fetch-chrome/);
});
