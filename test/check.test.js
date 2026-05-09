'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { collectTargets } = require('../bin/check');

const repoRoot = path.resolve(__dirname, '..');

test('check.collectTargets discovers bin, lib, and every skill scripts dir', async () => {
  const targets = await collectTargets();
  const rels = targets.map(t => path.relative(repoRoot, t)).sort();

  for (const expected of [
    'bin/agent-skills.js',
    'bin/check.js',
    'bin/vendor.js',
    'lib/atlassian-browser.js',
    'skills/bitbucket-browser-fetch/scripts/bitbucket-browser-fetch.js',
    'skills/bitbucket-browser-fetch/scripts/lib.js',
    'skills/confluence-browser-fetch/scripts/confluence-browser-fetch.js',
    'skills/confluence-browser-fetch/scripts/lib.js',
    'skills/confluence-update/scripts/confluence-update.js',
    'skills/confluence-update/scripts/lib.js',
    'skills/jira-browser-fetch/scripts/jira-browser-fetch.js',
    'skills/jira-browser-fetch/scripts/lib.js',
    'skills/jira-update/scripts/jira-update.js',
    'skills/jira-update/scripts/lib.js',
  ]) {
    assert.ok(rels.includes(expected), `expected ${expected} in discovered targets, got: ${rels.join(', ')}`);
  }
});

test('check.js CLI exits 0 when all files parse', () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'bin/check.js'), '--no-vendor'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /Syntax-checked \d+ file\(s\)/);
});
