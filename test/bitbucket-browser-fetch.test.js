'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const script = path.join(repoRoot, 'skills/bitbucket-browser-fetch/scripts/bitbucket-browser-fetch.js');
const lib = require('../skills/bitbucket-browser-fetch/scripts/lib');

test('bitbucket parseProjectInput accepts project URLs', () => {
  assert.deepEqual(
    lib.parseProjectInput('https://bitbucket.org/myneva/workspace/projects/SWI'),
    {
      source: 'https://bitbucket.org/myneva/workspace/projects/SWI',
      workspace: 'myneva',
      projectKey: 'SWI',
      browseUrl: 'https://bitbucket.org/myneva/workspace/projects/SWI',
    }
  );
  assert.throws(() => lib.parseProjectInput('https://example.com/myneva/workspace/projects/SWI'), /Expected bitbucket.org/);
  assert.throws(() => lib.parseProjectInput('https://bitbucket.org/myneva/repo'), /Could not parse/);
});

test('bitbucket repositoriesApiUrl builds internal API URL', () => {
  assert.equal(
    lib.repositoriesApiUrl('myneva', 'SWI', 2, 50),
    'https://bitbucket.org/!api/internal/workspaces/myneva/projects/SWI/repositories?page=2&pagelen=50&sort=name&fields=%2Bvalues.parent'
  );
});

test('bitbucket normalizeRepo extracts clone urls and metadata', () => {
  const repo = lib.normalizeRepo({
    uuid: '{abc}',
    name: 'Swing Agent',
    slug: 'swing-agent',
    full_name: 'myneva/swing-agent',
    project: { key: 'SWI', name: 'Swing' },
    is_private: true,
    scm: 'git',
    links: { html: { href: 'https://bitbucket.org/myneva/swing-agent' } },
  });
  assert.equal(repo.fullName, 'myneva/swing-agent');
  assert.equal(repo.projectKey, 'SWI');
  assert.equal(repo.clone.ssh, 'git@bitbucket.org:myneva/swing-agent.git');
  assert.equal(repo.clone.https, 'https://bitbucket.org/myneva/swing-agent.git');
});

test('bitbucket repositoriesMarkdown and cloneScript are useful for agents', () => {
  const manifest = { fetchedAt: 'now', workspace: 'myneva', projectKey: 'SWI', repositoryCount: 1, repositories: [{ fullName: 'myneva/swing-agent', isPrivate: true, htmlUrl: 'https://bitbucket.org/myneva/swing-agent', clone: { ssh: 'git@bitbucket.org:myneva/swing-agent.git' } }] };
  assert.match(lib.repositoriesMarkdown(manifest), /myneva\/swing-agent/);
  assert.match(lib.cloneScript(), /git clone/);
  assert.match(lib.cloneScript(), /clone-ssh.txt/);
});

test('bitbucket CLI --help exits successfully without browser', () => {
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: bitbucket-browser-fetch/);
});

test('bitbucket CLI fails fast when project URL is missing', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /Usage: bitbucket-browser-fetch/);
});
