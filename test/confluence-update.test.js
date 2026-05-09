'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const script = path.join(repoRoot, 'skills/confluence-update/scripts/confluence-update.js');
const lib = require('../skills/confluence-update/scripts/lib');

test('confluence-update extractPageId supports ids and URLs', () => {
  assert.equal(lib.extractPageId('123456'), '123456');
  assert.equal(lib.extractPageId('https://example.atlassian.net/wiki/spaces/ABC/pages/123456/Page+Title'), '123456');
  assert.equal(lib.extractPageId('https://example.atlassian.net/wiki/pages/viewpage.action?pageId=987654'), '987654');
  assert.equal(lib.extractPageId('not a url'), null);
});

test('confluence-update markdownToStorage converts simple agent content', () => {
  assert.equal(
    lib.markdownToStorage('# Title\n\nHello **world** and [link](https://example.com).\n\n- one\n- two'),
    '<h1>Title</h1>\n<p>Hello <strong>world</strong> and <a href="https://example.com">link</a>.</p>\n<ul><li>one</li><li>two</li></ul>'
  );
});

test('confluence-update wrapMacro supports page-properties', () => {
  const result = lib.wrapMacro('<p>Content</p>', 'page-properties');
  assert.match(result, /ac:name="details"/);
  assert.match(result, /<ac:rich-text-body><p>Content<\/p><\/ac:rich-text-body>/);
  assert.match(result, /ac:macro-id="[a-f0-9-]+"/);

  const generic = lib.wrapMacro('<p>Content</p>', 'info');
  assert.match(generic, /ac:name="info"/);
});

test('confluence-update replaceMarkedBlock replaces only marker contents', () => {
  const page = '<p>Intro</p>\n<!-- agent-block:summary:start -->\n<p>Old</p>\n<!-- agent-block:summary:end -->\n<p>Footer</p>';
  assert.equal(
    lib.replaceMarkedBlock(page, 'summary', '<p>New</p>'),
    '<p>Intro</p>\n<!-- agent-block:summary:start -->\n<p>New</p>\n<!-- agent-block:summary:end -->\n<p>Footer</p>'
  );
  assert.throws(() => lib.replaceMarkedBlock(page, 'missing', '<p>New</p>'), /Marker block not found/);
});

test('confluence-update replaceTextMatch and replaceLocalId work safely', () => {
  const page = '<p>Intro</p>\n<p local-id="123">Old</p>\n<p>Footer</p>';
  assert.equal(
    lib.replaceTextMatch(page, '<p>Intro</p>', '<p>New Intro</p>'),
    '<p>New Intro</p>\n<p local-id="123">Old</p>\n<p>Footer</p>'
  );
  assert.throws(() => lib.replaceTextMatch(page, '<p>', '<p>New</p>'), /Match text is not unique/);
  assert.throws(() => lib.replaceTextMatch(page, 'Missing', 'New'), /Match text not found/);

  assert.equal(
    lib.replaceLocalId(page, '123', '<p local-id="123">New</p>'),
    '<p>Intro</p>\n<p local-id="123">New</p>\n<p>Footer</p>'
  );
  assert.throws(() => lib.replaceLocalId(page, '999', '<p>New</p>'), /local-id not found/);
});

test('confluence-update generateSimpleDiff shows sizes', () => {
  assert.match(lib.generateSimpleDiff('a\nb', 'a\nb\nc'), /Size changed: 3 bytes -> 5 bytes/);
  assert.match(lib.generateSimpleDiff('a', 'a'), /No changes/);
});

test('confluence-update CLI --help exits successfully without browser', () => {
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: confluence-update/);
  assert.match(result.stdout, /replace-block/);
});

test('confluence-update CLI per-command --help prints command-specific section', () => {
  for (const cmd of ['update', 'replace-block', 'replace-text', 'replace-element', 'create']) {
    const result = spawnSync(process.execPath, [script, cmd, '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${cmd} --help exit: ${result.status}, stderr: ${result.stderr}`);
    assert.match(result.stdout, new RegExp(`Usage: confluence-update ${cmd}`), `${cmd} help should mention command`);
  }
});

test('confluence-update CLI fails fast when site is missing', () => {
  const result = spawnSync(process.execPath, [script, 'update', '123456', '--file', 'page.html'], {
    encoding: 'utf8',
    env: { ...process.env, CONFLUENCE_SITE: '' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Missing Atlassian site/);
});
