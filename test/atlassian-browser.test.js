'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const lib = require('../lib/atlassian-browser');

test('atlassian-browser exports the documented surface', () => {
  assert.equal(typeof lib.createBrowserSession, 'function');
  assert.equal(typeof lib.findBrowserExecutable, 'function');
  assert.equal(typeof lib.resolveBrowserCandidate, 'function');
  assert.equal(typeof lib.connectCdp, 'function');
});

test('resolveBrowserCandidate returns null for missing candidates', () => {
  assert.equal(lib.resolveBrowserCandidate(null), null);
  assert.equal(lib.resolveBrowserCandidate(''), null);
  assert.equal(lib.resolveBrowserCandidate('/nonexistent/path/to/binary'), null);
});

test('resolveBrowserCandidate finds an executable on PATH', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-cand-'));
  const fake = path.join(tmp, 'fake-browser');
  fs.writeFileSync(fake, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(fake, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = tmp;
  try {
    assert.equal(lib.resolveBrowserCandidate('fake-browser'), fake);
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('createBrowserSession returns an object with the documented methods', () => {
  const session = lib.createBrowserSession({
    port: 9999,
    profileDir: '/tmp/none',
    waitSec: 1,
    serverHost: 'example.atlassian.net',
    verifySession: async () => ({ ok: true, url: 'https://example/probe' }),
  });
  for (const m of [
    'ensureBrowser',
    'getCookieWithWait',
    'getCookieHeader',
    'fetchText',
    'fetchJson',
    'launchChrome',
    'devtoolsReady',
  ]) {
    assert.equal(typeof session[m], 'function', `session.${m} should be a function`);
  }
});
