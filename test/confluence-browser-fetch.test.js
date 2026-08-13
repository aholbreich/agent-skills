'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../skills/confluence-browser-fetch/scripts/lib');
const {
  inferConfluenceDeployment,
  inferContextFromPageUrl,
  normalizeContextPath,
} = require('../skills/confluence-browser-fetch/scripts/confluence-deployment');

const repoRoot = path.resolve(__dirname, '..');
const script = path.join(repoRoot, 'skills/confluence-browser-fetch/scripts/confluence-browser-fetch.js');

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

test('confluence extractPageId supports Cloud and classic Server/Data Center URLs', () => {
  assert.equal(lib.extractPageId('123456'), '123456');
  assert.equal(lib.extractPageId('https://example.atlassian.net/wiki/spaces/ABC/pages/123456/Page+Title'), '123456');
  assert.equal(lib.extractPageId('https://confluence.example.com/pages/viewpage.action?pageId=987654'), '987654');
  assert.equal(lib.extractPageId('https://confluence.example.com/pages/releaseview.action?pageId=149000000'), '149000000');
  assert.equal(lib.extractPageId('https://example.atlassian.net/wiki/spaces/ABC/overview?homepageId=173015042'), '173015042');
  assert.equal(lib.extractPageId('not a url'), null);
});

test('Confluence deployment infers Cloud /wiki context', () => {
  const deployment = inferConfluenceDeployment({ site: 'https://example.atlassian.net' });
  assert.equal(deployment.origin, 'https://example.atlassian.net');
  assert.equal(deployment.contextPath, '/wiki');
  assert.equal(deployment.api('content/123'), 'https://example.atlassian.net/wiki/rest/api/content/123');
  assert.equal(deployment.web('/spaces/ABC/pages/123/Test'), 'https://example.atlassian.net/wiki/spaces/ABC/pages/123/Test');
  assert.equal(deployment.web('/wiki/rest/api/content?start=1'), 'https://example.atlassian.net/wiki/rest/api/content?start=1');
});

test('Confluence deployment derives root Server/Data Center context from classic URL', () => {
  const input = 'https://confluence.example.com/pages/releaseview.action?pageId=149000000';
  const deployment = inferConfluenceDeployment({ inputs: [input] });
  assert.equal(deployment.origin, 'https://confluence.example.com');
  assert.equal(deployment.contextPath, '');
  assert.equal(deployment.api('content/149000000'), 'https://confluence.example.com/rest/api/content/149000000');
  assert.equal(deployment.web('/pages/viewpage.action?pageId=149000000'), 'https://confluence.example.com/pages/viewpage.action?pageId=149000000');
});

test('Confluence deployment supports explicit custom reverse-proxy context', () => {
  const deployment = inferConfluenceDeployment({
    site: 'https://intranet.example.com',
    contextPath: '/confluence/',
  });
  assert.equal(normalizeContextPath('/confluence/'), '/confluence');
  assert.equal(deployment.contextPath, '/confluence');
  assert.equal(deployment.api('space'), 'https://intranet.example.com/confluence/rest/api/space');
  assert.equal(deployment.web('/download/attachments/1/a.txt'), 'https://intranet.example.com/confluence/download/attachments/1/a.txt');
});

test('Confluence deployment rejects mixed origins and detects context markers', () => {
  assert.equal(inferContextFromPageUrl(new URL('https://example.com/wiki/spaces/A/pages/1/T')), '/wiki');
  assert.equal(inferContextFromPageUrl(new URL('https://example.com/confluence/pages/viewpage.action?pageId=1')), '/confluence');
  assert.throws(() => inferConfluenceDeployment({
    site: 'https://one.example.com',
    inputs: ['https://two.example.com/pages/viewpage.action?pageId=1'],
  }), /does not match/);
  assert.throws(() => inferConfluenceDeployment({ inputs: ['http://confluence.example.com/pages/viewpage.action?pageId=1'] }), /HTTPS/);
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
  assert.match(result.stdout, /Cloud or Server\/Data Center/);
  assert.match(result.stdout, /browser-context requests/i);
});

test('confluence CLI fails fast when site and absolute URL are missing', () => {
  const result = spawnSync(process.execPath, [script, '123456'], {
    encoding: 'utf8',
    env: { ...process.env, CONFLUENCE_SITE: '' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Missing Confluence site/);
});

test('confluence CLI validates backend before browser launch', () => {
  const result = spawnSync(process.execPath, [script, '123456', '--site', 'https://confluence.example.com', '--browser-backend', 'remote'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /browser-backend/);
});

test('confluence browser-context runtime is self-contained without legacy cookie library', () => {
  const scriptsDir = path.join(repoRoot, 'skills/confluence-browser-fetch/scripts');
  for (const file of ['browser-context.js', 'launch-windows-browser.ps1', 'confluence-deployment.js']) {
    assert.equal(fs.existsSync(path.join(scriptsDir, file)), true, `missing ${file}`);
  }
  assert.equal(fs.existsSync(path.join(scriptsDir, 'atlassian-browser.js')), false);
});
