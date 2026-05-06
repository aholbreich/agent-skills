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

test('jira parseBacklogInput accepts Jira Software backlog URLs and board ids', () => {
  assert.deepEqual(
    lib.parseBacklogInput('https://example.atlassian.net/jira/software/c/projects/SW2/boards/1771/backlog?epics=visible'),
    {
      boardId: 1771,
      source: 'https://example.atlassian.net/jira/software/c/projects/SW2/boards/1771/backlog?epics=visible',
      browseUrl: 'https://example.atlassian.net/jira/software/c/projects/SW2/boards/1771/backlog?epics=visible',
    }
  );
  assert.deepEqual(
    lib.parseBacklogInput('1771', 'https://example.atlassian.net/'),
    {
      boardId: 1771,
      source: '1771',
      browseUrl: 'https://example.atlassian.net/jira/software/c/boards/1771/backlog',
    }
  );
  assert.throws(() => lib.parseBacklogInput('https://example.atlassian.net/issues/?jql=project=SW2'), /Could not parse/);
});

test('jira backlogApiUrl and issueKeysFromAgilePage support backlog pagination helpers', () => {
  assert.equal(
    lib.backlogApiUrl('https://example.atlassian.net/', 1771, 100, 50),
    'https://example.atlassian.net/rest/agile/1.0/board/1771/backlog?startAt=100&maxResults=50'
  );
  assert.deepEqual(
    lib.issueKeysFromAgilePage({ issues: [{ key: 'SW2-1' }, {}, { key: 'SW2-2' }] }),
    ['SW2-1', 'SW2-2']
  );
  assert.deepEqual(lib.issueKeysFromAgilePage({}), []);
});

test('jira CLI --help exits successfully without browser', () => {
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: jira-browser-fetch/);
  assert.match(result.stdout, /--backlog URL\|BOARD_ID/);
});

test('jira CLI fails fast when server is missing', () => {
  const result = spawnSync(process.execPath, [script, 'PROJ-123'], {
    encoding: 'utf8',
    env: { ...process.env, JIRA_SERVER: '' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Missing Jira server/);
});
