'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  BrowserContextTransport,
  createBrowserContextSession,
  selectBrowserBackend,
  validateOrigin,
  validateSameOriginUrl,
} = require('../lib/browser-context');

const repoRoot = path.resolve(__dirname, '..');

function valueResponse(value) {
  return { result: { value } };
}

test('browser-context validates HTTPS and exact origins', () => {
  assert.equal(validateOrigin('https://confluence.example.com/path'), 'https://confluence.example.com');
  assert.equal(validateSameOriginUrl('/rest/api/content/1', 'https://confluence.example.com'), 'https://confluence.example.com/rest/api/content/1');
  assert.throws(() => validateOrigin('http://confluence.example.com'), /HTTPS/);
  assert.throws(() => validateSameOriginUrl('https://login.example.net/', 'https://confluence.example.com'), /cross-origin/);
});

test('browser-context accepts explicit backends and rejects unknown ones', () => {
  assert.equal(selectBrowserBackend('native'), 'native');
  assert.equal(selectBrowserBackend('windows-wsl'), 'windows-wsl');
  assert.throws(() => selectBrowserBackend('remote'), /Unsupported/);
});

test('text requests execute a same-origin credentialed GET in browser context', async () => {
  let expression = '';
  const client = {
    async send(method, params) {
      assert.equal(method, 'Runtime.evaluate');
      expression = params.expression;
      return valueResponse({
        status: 200,
        statusText: 'OK',
        url: 'https://confluence.example.com/rest/api/content/1',
        contentType: 'application/json',
        text: '{"id":"1"}',
        receivedBytes: 10,
      });
    },
    close() {},
  };
  const transport = new BrowserContextTransport({ client, origin: 'https://confluence.example.com' });
  const result = await transport.json('https://confluence.example.com/rest/api/content/1');
  assert.deepEqual(result.json, { id: '1' });
  assert.match(expression, /method: 'GET'/);
  assert.match(expression, /credentials: 'include'/);
  assert.doesNotMatch(expression, /Cookie|Network\.getCookies|Storage\.getCookies|document\.cookie/);
});

test('cross-origin requests are rejected before CDP evaluation', async () => {
  let calls = 0;
  const transport = new BrowserContextTransport({
    origin: 'https://confluence.example.com',
    client: { async send() { calls++; }, close() {} },
  });
  await assert.rejects(() => transport.text('https://evil.example.net/'), /cross-origin/);
  assert.equal(calls, 0);
});

test('cross-origin response metadata is rejected again in Node', async () => {
  const transport = new BrowserContextTransport({
    origin: 'https://confluence.example.com',
    client: {
      async send() {
        return valueResponse({ status: 200, url: 'https://login.example.net/', contentType: 'text/html', text: 'login' });
      },
      close() {},
    },
  });
  await assert.rejects(() => transport.text('/rest/api/content/1'), /cross-origin/);
});

test('binary requests transfer bounded data in base64 chunks and clean up', async () => {
  const expected = Buffer.from('abc');
  let transferId;
  let cleanupSeen = false;
  const client = {
    async send(method, params) {
      assert.equal(method, 'Runtime.evaluate');
      const expression = params.expression;
      if (expression.includes('const config =') && expression.includes('__agentSkillsBinaryTransfers')) {
        const match = expression.match(/const config = (\{.*\});/);
        const config = JSON.parse(match[1]);
        transferId = config.transferId;
        assert.equal(config.maxBytes, 10);
        return valueResponse({ status: 200, url: config.url, contentType: 'application/octet-stream', transferId, receivedBytes: expected.length });
      }
      if (expression.includes('return btoa(binary)')) return valueResponse(expected.toString('base64'));
      if (expression.includes('delete globalThis.__agentSkillsBinaryTransfers')) {
        cleanupSeen = true;
        return valueResponse(true);
      }
      throw new Error(`Unexpected expression: ${expression.slice(0, 100)}`);
    },
    close() {},
  };
  const transport = new BrowserContextTransport({ client, origin: 'https://confluence.example.com' });
  const result = await transport.buffer('/download/attachments/1/file.bin', { maxBytes: 10 });
  assert.equal(result.transferId, transferId);
  assert.deepEqual(result.buffer, expected);
  assert.equal(cleanupSeen, true);
});

test('session factory exposes selected backend without launching a browser', () => {
  const session = createBrowserContextSession({
    origin: 'https://confluence.example.com',
    browserBackend: 'native',
    port: 9444,
    waitSec: 1,
  });
  assert.equal(session.browserBackend, 'native');
  assert.equal(typeof session.waitForAuthenticatedTransport, 'function');
  assert.equal(typeof session.closeBrowser, 'function');
});

test('new Confluence browser-context path contains no cookie or storage extraction', () => {
  const files = [
    'lib/browser-context.js',
    'skills/confluence-browser-fetch/scripts/browser-context.js',
    'skills/confluence-browser-fetch/scripts/confluence-browser-fetch.js',
  ];
  const forbidden = /Network\.getCookies|Storage\.getCookies|document\.cookie|localStorage|sessionStorage|headers\s*:\s*\{[^}]*Cookie/s;
  for (const file of files) {
    const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    assert.doesNotMatch(text, forbidden, `${file} must not extract or replay browser credentials`);
  }
});

test('Windows launcher encodes dedicated-profile and loopback safeguards', () => {
  const launcher = fs.readFileSync(path.join(repoRoot, 'lib/launch-windows-browser.ps1'), 'utf8');
  assert.match(launcher, /\.agent-skills-browser-profile\.json/);
  assert.match(launcher, /non-empty and is not marked/);
  assert.match(launcher, /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(launcher, /--remote-allow-origins=http:\/\/127\.0\.0\.1/);
  assert.match(launcher, /Refusing to attach or stop it/);
  assert.doesNotMatch(launcher, /--remote-allow-origins=\*/);
});
