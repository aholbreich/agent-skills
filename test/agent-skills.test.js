'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const script = path.join(repoRoot, 'bin/agent-skills.js');

test('agent-skills help exits successfully', () => {
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: agent-skills/);
});

test('agent-skills list prints bundled skills', () => {
  const result = spawnSync(process.execPath, [script, 'list'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /jira-browser-fetch/);
  assert.match(result.stdout, /confluence-browser-fetch/);
});

test('agent-skills dry-run install reports target without writing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skills-test-'));
  const result = spawnSync(process.execPath, [script, 'install', '--dir', tmp, '--dry-run'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run/);
  assert.equal(fs.existsSync(path.join(tmp, 'jira-browser-fetch')), false);
});

test('agent-skills default install target is generic ~/.agents/skills', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skills-home-'));
  const result = spawnSync(process.execPath, [script, 'install', '--dry-run'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, new RegExp(`${home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.agents/skills`));
});

test('agent-skills install copies skills and skips existing unless forced', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skills-test-'));
  let result = spawnSync(process.execPath, [script, 'install', '--dir', tmp], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(path.join(tmp, 'jira-browser-fetch/SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(tmp, 'confluence-browser-fetch/SKILL.md')), true);

  result = spawnSync(process.execPath, [script, 'install', '--dir', tmp], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /SKIP jira-browser-fetch/);

  result = spawnSync(process.execPath, [script, 'install', '--dir', tmp, '--force'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /OVERWRITE jira-browser-fetch/);
});
