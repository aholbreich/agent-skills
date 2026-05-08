# jira-update + shared atlassian-browser library — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `jira-update` skill (create / comment / transition / update-fields / link, all dry-run-first) and refactor the duplicated browser/CDP/cookie code from the four existing skills into one source-of-truth library that's vendored into each skill at pack time.

**Architecture:** Single source `lib/atlassian-browser.js` exports a `createBrowserSession({...})` factory plus low-level helpers. A `prepack`-time vendor step copies the file into each `skills/*/scripts/atlassian-browser.js` so each shipped skill folder remains self-contained on disk. Vendored copies are gitignored and a CI drift test fails the build if they fall out of sync. The new `jira-update` skill follows `confluence-update`'s safety model: dry-run by default, `--apply` to write, audit dir under `raw/jira-updates/`. Markdown-to-ADF conversion is the default for description/comment input; ADF passthrough is the escape hatch.

**Tech Stack:** Node.js 22+ (built-in `fetch`, `WebSocket`, `node:test`), no runtime npm dependencies. CommonJS modules. Chrome DevTools Protocol over WebSocket for cookie extraction. Jira Cloud REST v3.

**Spec:** `docs/superpowers/specs/2026-05-08-jira-update-and-shared-browser-lib-design.md`

---

## File Structure

**New files:**
- `lib/atlassian-browser.js` — single source of truth for browser/CDP/cookie code
- `skills/jira-update/SKILL.md`
- `skills/jira-update/scripts/jira-update.js` — CLI entry
- `skills/jira-update/scripts/lib.js` — Markdown→ADF, payload builders, command helpers
- `skills/jira-update/references/usage.md`
- `skills/jira-update/references/distribution.md`
- `test/atlassian-browser.test.js` — unit tests for the shared library
- `test/jira-update.test.js` — unit + CLI smoke tests for the new skill
- `test/vendor.test.js` — drift guard

**Modified files:**
- `package.json` — add `vendor` script, `prepack` hook, new `bin` entry, version bump
- `.gitignore` — exclude vendored copies
- `skills/jira-browser-fetch/scripts/jira-browser-fetch.js` — replace inlined helpers with `require('./atlassian-browser')`
- `skills/confluence-browser-fetch/scripts/confluence-browser-fetch.js` — same
- `skills/confluence-update/scripts/confluence-update.js` — same (donor source for the extraction)
- `skills/bitbucket-browser-fetch/scripts/bitbucket-browser-fetch.js` — same
- `README.md` — add `jira-update` to the skills table + examples
- `CHANGELOG.md` — add entries for refactor + new skill
- `test/skill-compliance.test.js` — implicit coverage of the new skill via the directory scan (no edit needed); spot-check assumptions

---

## Phase A — Shared library refactor

### Task A1: Extract `lib/atlassian-browser.js`

**Files:**
- Create: `lib/atlassian-browser.js`
- Test: `test/atlassian-browser.test.js`
- Reference: `skills/confluence-update/scripts/confluence-update.js:156-394` (donor — most recent canonical implementation)

- [ ] **Step 1: Write the failing test for `resolveBrowserCandidate` and the factory shape**

Create `test/atlassian-browser.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
node --test test/atlassian-browser.test.js
```

Expected: FAIL — `Cannot find module '../lib/atlassian-browser'`.

- [ ] **Step 3: Write `lib/atlassian-browser.js`**

Create the file with the extracted helpers. Use `confluence-update.js` lines 156–394 as the donor. The factory wraps mutable session config; per-skill probes are injected via `verifySession`.

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isExecutable(file) {
  try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; }
}

function resolveBrowserCandidate(candidate) {
  if (!candidate) return null;
  if (candidate.includes(path.sep)) return isExecutable(candidate) ? candidate : null;
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, candidate);
    if (isExecutable(full)) return full;
  }
  return null;
}

function findBrowserExecutable() {
  const candidates = [
    process.env.CHROME,
    process.env.CHROMIUM,
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'brave-browser',
    'brave',
    'microsoft-edge',
    'microsoft-edge-stable',
    'vivaldi',
    'vivaldi-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
  ];
  for (const candidate of candidates) {
    const resolved = resolveBrowserCandidate(candidate);
    if (resolved) return resolved;
  }
  throw new Error('Could not find a Chromium-compatible browser. Install Chrome/Chromium/Brave/Edge/Vivaldi or set CHROME=/path/to/browser.');
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const failTimer = setTimeout(() => reject(new Error('CDP websocket timeout')), 10000);

    ws.addEventListener('open', () => {
      clearTimeout(failTimer);
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const msgId = ++id;
            pending.set(msgId, { res, rej });
            ws.send(JSON.stringify({ id: msgId, method, params }));
          });
        },
        close() { try { ws.close(); } catch {} },
      });
    });

    ws.addEventListener('message', ev => {
      let data = ev.data;
      if (typeof data !== 'string') data = Buffer.from(data).toString('utf8');
      const msg = JSON.parse(data);
      if (!msg.id || !pending.has(msg.id)) return;
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(`${msg.error.message || 'CDP error'} ${JSON.stringify(msg.error)}`));
      else res(msg.result);
    });

    ws.addEventListener('error', err => reject(err));
  });
}

function createBrowserSession({ port, profileDir, waitSec, serverHost, verifySession, cookieUrls, userAgent }) {
  if (!serverHost) throw new Error('createBrowserSession requires serverHost');
  if (typeof verifySession !== 'function') throw new Error('createBrowserSession requires verifySession callback');
  const ua = userAgent || 'agent-skills/1.0';

  async function endpoint(pathname) {
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`);
    if (!res.ok) throw new Error(`DevTools HTTP ${res.status} for ${pathname}`);
    return res.json();
  }

  async function devtoolsReady() {
    try { await endpoint('/json/version'); return true; } catch { return false; }
  }

  async function waitDevtools() {
    for (let i = 0; i < 80; i++) {
      if (await devtoolsReady()) return;
      await sleep(250);
    }
    throw new Error('Chrome DevTools endpoint did not start');
  }

  async function openDevtoolsTab(url) {
    if (!url) return false;
    const endpointUrl = `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`;
    for (const init of [{ method: 'PUT' }, {}]) {
      try {
        const res = await fetch(endpointUrl, init);
        if (res.ok) { await sleep(500); return true; }
      } catch {}
    }
    return false;
  }

  async function hasDevtoolsTabForHost(url, pathPrefix) {
    if (!url) return false;
    const host = new URL(url).host;
    const list = await endpoint('/json/list');
    return list.some(t => t.type === 'page' && t.url && (() => {
      try {
        const tabUrl = new URL(t.url);
        if (tabUrl.host !== host) return false;
        if (pathPrefix && !tabUrl.pathname.startsWith(pathPrefix)) return false;
        return true;
      } catch { return false; }
    })());
  }

  function launchChrome(url) {
    const browser = findBrowserExecutable();
    const args = [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-allow-origins=*',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      url,
    ];
    console.log(`Launching browser: ${browser}`);
    const child = spawn(browser, args, { detached: true, stdio: 'ignore' });
    child.on('error', err => console.error(`Failed to launch browser ${browser}: ${err.message}`));
    child.unref();
  }

  async function ensureBrowser(openUrl, { tabPathPrefix } = {}) {
    if (!(await devtoolsReady())) {
      console.log(`Opening Chromium-compatible browser with reusable profile: ${profileDir}`);
      launchChrome(openUrl);
    } else {
      console.log(`Reusing Chrome DevTools on port ${port}`);
      if (openUrl) {
        const hasTab = await hasDevtoolsTabForHost(openUrl, tabPathPrefix);
        if (hasTab) {
          console.log(`Found existing tab for ${new URL(openUrl).host}; not opening another tab.`);
        } else {
          const opened = await openDevtoolsTab(openUrl);
          if (opened) console.log(`Opened target URL in reused browser: ${openUrl}`);
          else console.warn('Could not open target URL through DevTools; continuing with existing tabs.');
        }
      }
    }
    await waitDevtools();
  }

  async function getPageWsUrl() {
    const list = await endpoint('/json/list');
    const pages = list.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
    const preferred = pages.find(t => (t.url || '').includes(serverHost)) || pages[0];
    return preferred && preferred.webSocketDebuggerUrl;
  }

  async function getCookieHeader() {
    const wsUrl = await getPageWsUrl();
    if (!wsUrl) return '';
    const cdp = await connectCdp(wsUrl);
    try {
      await cdp.send('Network.enable');
      const urls = (cookieUrls && cookieUrls.length) ? cookieUrls : [`https://${serverHost}/`];
      const result = await cdp.send('Network.getCookies', { urls });
      const cookies = (result.cookies || [])
        .filter(c => c.domain && (c.domain === serverHost || c.domain.endsWith(`.${serverHost}`)))
        .map(c => `${c.name}=${c.value}`);
      return cookies.join('; ');
    } finally {
      cdp.close();
    }
  }

  async function fetchText(url, cookie, options = {}) {
    const method = options.method || 'GET';
    const headers = {
      Cookie: cookie,
      Accept: options.accept || '*/*',
      'User-Agent': ua,
    };
    if (options.body !== undefined && options.body !== null) headers['Content-Type'] = options.contentType || 'application/json';
    const res = await fetch(url, { method, redirect: 'follow', headers, body: options.body ?? null });
    return { status: res.status, contentType: res.headers.get('content-type') || '', text: await res.text() };
  }

  async function fetchJson(url, cookie, options = {}) {
    const result = await fetchText(url, cookie, { ...options, accept: options.accept || 'application/json' });
    let json = null;
    try { json = JSON.parse(result.text); } catch {}
    return { ...result, json };
  }

  async function getCookieWithWait(openUrl, { tabPathPrefix } = {}) {
    await ensureBrowser(openUrl, { tabPathPrefix });
    console.log(`If prompted in Chrome, complete SSO for: ${openUrl}`);
    const deadline = Date.now() + waitSec * 1000;
    let last = '';
    while (Date.now() < deadline) {
      try {
        const cookie = await getCookieHeader();
        const result = await verifySession(cookie);
        if (result && result.ok) {
          if (process.stdout.isTTY) process.stdout.write('\n');
          console.log(`Authenticated session verified${result.url ? ` via ${result.url}` : ''}`);
          return cookie;
        }
        last = (result && result.message) || 'session not yet verified';
      } catch (e) { last = e.message; }
      if (process.stdout.isTTY) {
        process.stdout.write(`\r${new Date().toLocaleTimeString()} ${last.padEnd(120).slice(0, 120)}`);
      }
      await sleep(3000);
    }
    if (process.stdout.isTTY) process.stdout.write('\n');
    throw new Error(`Could not verify authenticated session. Last result: ${last}`);
  }

  return {
    devtoolsReady,
    waitDevtools,
    openDevtoolsTab,
    hasDevtoolsTabForHost,
    launchChrome,
    ensureBrowser,
    getPageWsUrl,
    getCookieHeader,
    getCookieWithWait,
    fetchText,
    fetchJson,
  };
}

module.exports = {
  createBrowserSession,
  findBrowserExecutable,
  resolveBrowserCandidate,
  connectCdp,
};
```

- [ ] **Step 4: Run the tests**

```bash
node --test test/atlassian-browser.test.js
```

Expected: PASS (all four tests).

- [ ] **Step 5: Run full check + tests**

```bash
node --check lib/atlassian-browser.js && npm test
```

Expected: all tests still pass (existing skill tests untouched at this point).

- [ ] **Step 6: Commit**

```bash
git add lib/atlassian-browser.js test/atlassian-browser.test.js
git commit -m "feat: add shared atlassian-browser library

Extracts the duplicated browser/CDP/cookie code into a single
source-of-truth module with a createBrowserSession factory."
```

---

### Task A2: Wire vendor script, prepack hook, gitignore, drift test

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `test/vendor.test.js`

- [ ] **Step 1: Write the failing drift test**

Create `test/vendor.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const source = path.join(repoRoot, 'lib/atlassian-browser.js');

test('vendor script copies atlassian-browser.js into every skill', () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'bin/vendor.js')], { encoding: 'utf8' });
  assert.equal(result.status, 0, `vendor failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

  const expected = fs.readFileSync(source, 'utf8');
  const skillsDir = path.join(repoRoot, 'skills');
  const skills = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory());
  for (const skill of skills) {
    const dest = path.join(skillsDir, skill.name, 'scripts/atlassian-browser.js');
    assert.equal(fs.existsSync(dest), true, `${skill.name}: missing vendored copy`);
    assert.equal(fs.readFileSync(dest, 'utf8'), expected, `${skill.name}: vendored copy diverged from source`);
  }
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
node --test test/vendor.test.js
```

Expected: FAIL — `bin/vendor.js` does not exist.

- [ ] **Step 3: Create the vendor script**

Create `bin/vendor.js`:

```js
#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const source = path.join(repoRoot, 'lib/atlassian-browser.js');
const skillsDir = path.join(repoRoot, 'skills');

if (!fs.existsSync(source)) {
  console.error(`vendor: source not found at ${source}`);
  process.exit(1);
}

const content = fs.readFileSync(source);
const skills = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory());
for (const skill of skills) {
  const scriptsDir = path.join(skillsDir, skill.name, 'scripts');
  if (!fs.existsSync(scriptsDir)) continue;
  const dest = path.join(scriptsDir, 'atlassian-browser.js');
  fs.writeFileSync(dest, content);
  console.log(`vendored -> ${path.relative(repoRoot, dest)}`);
}
```

Then make it executable:

```bash
chmod +x bin/vendor.js
```

- [ ] **Step 4: Update `.gitignore`**

Append to `.gitignore`:

```
# Vendored shared libraries (source of truth lives in lib/atlassian-browser.js)
skills/*/scripts/atlassian-browser.js
```

- [ ] **Step 5: Update `package.json` scripts and prepack**

Edit `package.json`. Add `vendor` and `prepack` scripts; update `check` and `ci` so they vendor first, and verify the vendored files compile.

```json
"scripts": {
  "vendor": "node bin/vendor.js",
  "check": "node --check bin/agent-skills.js && node --check bin/vendor.js && node --check lib/atlassian-browser.js && npm run vendor && node --check skills/jira-browser-fetch/scripts/jira-browser-fetch.js && node --check skills/jira-browser-fetch/scripts/lib.js && node --check skills/jira-browser-fetch/scripts/atlassian-browser.js && node --check skills/confluence-browser-fetch/scripts/confluence-browser-fetch.js && node --check skills/confluence-browser-fetch/scripts/lib.js && node --check skills/confluence-browser-fetch/scripts/atlassian-browser.js && node --check skills/confluence-update/scripts/confluence-update.js && node --check skills/confluence-update/scripts/lib.js && node --check skills/confluence-update/scripts/atlassian-browser.js && node --check skills/bitbucket-browser-fetch/scripts/bitbucket-browser-fetch.js && node --check skills/bitbucket-browser-fetch/scripts/lib.js && node --check skills/bitbucket-browser-fetch/scripts/atlassian-browser.js",
  "test": "node --test",
  "ci": "npm run check && npm test && npm pack --dry-run",
  "pack:dry": "npm pack --dry-run",
  "prepack": "npm run check",
  "prepublishOnly": "npm run check && npm test"
}
```

(Replace the existing `scripts` block with the above.)

- [ ] **Step 6: Run the drift test**

```bash
node --test test/vendor.test.js
```

Expected: PASS.

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

Expected: all tests pass. Note: existing skill tests still pass because they `require` their local `scripts/lib.js`, which is unchanged.

- [ ] **Step 8: Commit**

```bash
git add bin/vendor.js .gitignore package.json test/vendor.test.js
git commit -m "feat: vendor atlassian-browser.js into each skill at pack time

Single source of truth at lib/atlassian-browser.js. The vendor script
copies it into every skills/*/scripts/ directory so each shipped skill
folder remains self-contained. Vendored copies are gitignored. A drift
test runs the vendor step and asserts byte-equality against the source."
```

---

### Task A3: Migrate `confluence-update` to use the shared library

**Files:**
- Modify: `skills/confluence-update/scripts/confluence-update.js`

`confluence-update` is the donor whose code we extracted, so it migrates first — its semantics define the shared library, and the test suite for it will catch regressions immediately.

- [ ] **Step 1: Run baseline tests**

```bash
node --test test/confluence-update.test.js
```

Expected: PASS (baseline before migration).

- [ ] **Step 2: Replace inlined helpers with the shared library**

Edit `skills/confluence-update/scripts/confluence-update.js`. Remove lines 156–394 (the helper block) and replace with:

```js
const { createBrowserSession } = require('./atlassian-browser');

let session = null;
function getSession() {
  if (session) return session;
  session = createBrowserSession({
    port: opts.port,
    profileDir: opts.profileDir,
    waitSec: opts.waitSec,
    serverHost: new URL(opts.site).host,
    cookieUrls: [`${opts.site}/`, wikiBase],
    userAgent: 'confluence-update/1.0',
    verifySession: cookie => verifyConfluenceSession(cookie),
  });
  return session;
}

async function verifyConfluenceSession(cookie) {
  if (!cookie) return { ok: false, message: 'no Atlassian cookies yet' };
  const probes = [`${wikiBase}/rest/api/user/current`, `${wikiBase}/rest/api/space?limit=1`];
  for (const url of probes) {
    const result = await getSession().fetchJson(url, cookie);
    if (result.status === 200 && result.json) return { ok: true, url };
    if (result.status === 401 || result.status === 403) return { ok: false, message: `not authenticated yet (${result.status} from ${url})` };
    if (result.status === 302 || result.status === 303) return { ok: false, message: `still redirected to login (${result.status} from ${url})` };
    if (result.status === 404) continue;
    return { ok: false, message: `session probe HTTP ${result.status} from ${url}` };
  }
  return { ok: false, message: 'could not verify Confluence session' };
}
```

Then update call sites that previously called free functions: replace `await getCookieWithWait(openUrl)` with `await getSession().getCookieWithWait(openUrl, { tabPathPrefix: '/wiki' })`. Replace `fetchText(...)`, `fetchJson(...)` calls with `getSession().fetchText(...)` and `getSession().fetchJson(...)`. The HTTP helper signature changed: old style was `fetchText(url, cookie, method, body)`; new style is `fetchText(url, cookie, { method, body })`. Update accordingly:

- `fetchText(url, cookie)` → `getSession().fetchText(url, cookie)` (no change to the call structure)
- `fetchJson(url, cookie)` → `getSession().fetchJson(url, cookie)`
- `fetchText(url, cookie, 'PUT', payload)` → `getSession().fetchText(url, cookie, { method: 'PUT', body: payload })`
- `fetchJson(url, cookie, 'PUT', payload)` → `getSession().fetchJson(url, cookie, { method: 'PUT', body: JSON.stringify(payload) })` (note: callers previously passed an object; the new factory expects pre-serialized body — this is the breaking change to internalize)

**Cleaner alternative — keep the old call shape:** instead of changing call sites, add a small adapter inside `confluence-update.js`:

```js
async function fetchJsonAdapter(url, cookie, method = 'GET', json = null) {
  return getSession().fetchJson(url, cookie, {
    method,
    body: json === null ? null : JSON.stringify(json),
  });
}
```

Use `fetchJsonAdapter` everywhere the old `fetchJson` was used. Same for `fetchText`. This keeps the diff small.

- [ ] **Step 3: Run vendor + check**

```bash
npm run check
```

Expected: pass — all syntax checks succeed.

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests pass. The `confluence-update.test.js` smoke tests for `--help` and missing `--site` should still work because they exercise CLI option parsing, which is unchanged.

- [ ] **Step 5: Commit**

```bash
git add skills/confluence-update/scripts/confluence-update.js
git commit -m "refactor(confluence-update): use shared atlassian-browser library

Replace ~240 lines of inlined browser/CDP/cookie helpers with the
createBrowserSession factory from lib/atlassian-browser.js. Behavior
unchanged. The verifyConfluenceSession probe stays local."
```

---

### Task A4: Migrate `jira-browser-fetch`

**Files:**
- Modify: `skills/jira-browser-fetch/scripts/jira-browser-fetch.js`

- [ ] **Step 1: Run baseline tests**

```bash
node --test test/jira-browser-fetch.test.js
```

Expected: PASS.

- [ ] **Step 2: Replace inlined helpers**

Edit `skills/jira-browser-fetch/scripts/jira-browser-fetch.js`. Remove lines 113–349 (DevTools/CDP/cookie/browser block including `verifyJiraSession` body's HTTP machinery). Add at the top, after the existing `require` block:

```js
const { createBrowserSession } = require('./atlassian-browser');

let session = null;
function getSession() {
  if (session) return session;
  session = createBrowserSession({
    port: opts.port,
    profileDir: opts.profileDir,
    waitSec: opts.waitSec,
    serverHost: new URL(opts.server).host,
    cookieUrls: [`${opts.server}/`],
    userAgent: 'jira-browser-fetch/1.0',
    verifySession: cookie => verifyJiraSession(cookie),
  });
  return session;
}

async function fetchTextAdapter(url, cookie, accept) {
  return getSession().fetchText(url, cookie, { accept });
}

async function fetchJsonAdapter(url, cookie, accept) {
  return getSession().fetchJson(url, cookie, { accept });
}
```

Keep `verifyJiraSession` local (it has Jira-specific probes), but rewrite it to call `fetchJsonAdapter`:

```js
async function verifyJiraSession(cookie) {
  if (!cookie) return { ok: false, message: 'no Atlassian cookies yet' };
  const probes = [
    `${opts.server}/rest/api/3/myself`,
    `${opts.server}/rest/api/2/myself`,
  ];
  for (const url of probes) {
    const result = await fetchJsonAdapter(url, cookie, 'application/json');
    if (result.status === 200 && result.json && (result.json.accountId || result.json.name || result.json.key || result.json.displayName)) {
      return { ok: true, url };
    }
    if (result.status === 200) {
      const kind = result.json ? 'unexpected JSON response' : (/html/i.test(result.contentType) ? 'login page' : 'non-JSON response');
      return { ok: false, message: `not authenticated yet (${kind} from ${url})` };
    }
    if (result.status === 401 || result.status === 403) return { ok: false, message: `not authenticated yet (${result.status} from ${url})` };
    if (result.status === 302 || result.status === 303) return { ok: false, message: `still redirected to login (${result.status} from ${url})` };
    if (result.status === 404) continue;
    return { ok: false, message: `session probe HTTP ${result.status} from ${url}` };
  }
  return { ok: false, message: 'could not verify Jira session' };
}
```

Replace the rest of the call sites in the file:
- `fetchText(url, cookie, accept)` → `fetchTextAdapter(url, cookie, accept)`
- `fetchJson(url, cookie, accept)` → `fetchJsonAdapter(url, cookie, accept)`
- `getCookieWithWait(url)` → `getSession().getCookieWithWait(url)`

- [ ] **Step 3: Run check + tests**

```bash
npm run check && npm test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add skills/jira-browser-fetch/scripts/jira-browser-fetch.js
git commit -m "refactor(jira-browser-fetch): use shared atlassian-browser library"
```

---

### Task A5: Migrate `confluence-browser-fetch`

**Files:**
- Modify: `skills/confluence-browser-fetch/scripts/confluence-browser-fetch.js`

- [ ] **Step 1: Read the existing script to find the helper block**

```bash
grep -n "function endpoint\|function devtoolsReady\|function connectCdp\|function getCookieWithWait\|function ensureBrowser\|function launchChrome\|function findBrowserExecutable" skills/confluence-browser-fetch/scripts/confluence-browser-fetch.js
```

Note the line ranges. Helper block expected to be roughly at the same place as `confluence-update.js` (after option parsing).

- [ ] **Step 2: Apply the same migration pattern as Task A4**

In `skills/confluence-browser-fetch/scripts/confluence-browser-fetch.js`:

1. Remove the inlined helper block.
2. Add session factory + adapter wrappers, mirroring the confluence-update version (with `tabPathPrefix: '/wiki'` since this is Confluence).
3. Keep `verifyConfluenceSession` local (mirrors confluence-update's probe).

```js
const { createBrowserSession } = require('./atlassian-browser');

let session = null;
function getSession() {
  if (session) return session;
  session = createBrowserSession({
    port: opts.port,
    profileDir: opts.profileDir,
    waitSec: opts.waitSec,
    serverHost: new URL(opts.site).host,
    cookieUrls: [`${opts.site}/`, `${opts.site}/wiki`],
    userAgent: 'confluence-browser-fetch/1.0',
    verifySession: cookie => verifyConfluenceSession(cookie),
  });
  return session;
}

async function fetchTextAdapter(url, cookie, accept) {
  return getSession().fetchText(url, cookie, { accept });
}

async function fetchJsonAdapter(url, cookie, accept) {
  return getSession().fetchJson(url, cookie, { accept });
}
```

- [ ] **Step 3: Replace call sites**

Same pattern as A4: free `fetchText`/`fetchJson`/`getCookieWithWait` calls become adapter or `getSession().…` calls. When a `getCookieWithWait` call should target Confluence-only tabs, pass `{ tabPathPrefix: '/wiki' }`.

- [ ] **Step 4: Run tests**

```bash
npm run check && npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/confluence-browser-fetch/scripts/confluence-browser-fetch.js
git commit -m "refactor(confluence-browser-fetch): use shared atlassian-browser library"
```

---

### Task A6: Migrate `bitbucket-browser-fetch`

**Files:**
- Modify: `skills/bitbucket-browser-fetch/scripts/bitbucket-browser-fetch.js`

Bitbucket targets `bitbucket.org` instead of an Atlassian site host. The same factory works — `serverHost` is per-skill.

- [ ] **Step 1: Run baseline tests**

```bash
node --test test/bitbucket-browser-fetch.test.js
```

Expected: PASS.

- [ ] **Step 2: Apply the migration**

In `skills/bitbucket-browser-fetch/scripts/bitbucket-browser-fetch.js`, replace the inlined helper block with:

```js
const { createBrowserSession } = require('./atlassian-browser');

let session = null;
function getSession() {
  if (session) return session;
  session = createBrowserSession({
    port: opts.port,
    profileDir: opts.profileDir,
    waitSec: opts.waitSec,
    serverHost: 'bitbucket.org',
    cookieUrls: ['https://bitbucket.org/'],
    userAgent: 'bitbucket-browser-fetch/1.0',
    verifySession: cookie => verifyBitbucketSession(cookie),
  });
  return session;
}

async function fetchTextAdapter(url, cookie, accept) {
  return getSession().fetchText(url, cookie, { accept });
}

async function fetchJsonAdapter(url, cookie, accept) {
  return getSession().fetchJson(url, cookie, { accept });
}
```

Keep `verifyBitbucketSession` local. Replace call sites.

- [ ] **Step 3: Run tests**

```bash
npm run check && npm test
```

Expected: PASS.

- [ ] **Step 4: Run a smoke install of one skill and confirm vendored file is present**

```bash
npm pack --dry-run 2>&1 | grep atlassian-browser.js
```

Expected: shows `skills/<each-skill>/scripts/atlassian-browser.js` four times (one per migrated skill).

- [ ] **Step 5: Commit**

```bash
git add skills/bitbucket-browser-fetch/scripts/bitbucket-browser-fetch.js
git commit -m "refactor(bitbucket-browser-fetch): use shared atlassian-browser library"
```

---

## Phase B — `jira-update` skill foundation

### Task B1: Scaffold `jira-update` skill directory

**Files:**
- Create: `skills/jira-update/SKILL.md`
- Create: `skills/jira-update/scripts/jira-update.js`
- Create: `skills/jira-update/scripts/lib.js`
- Create: `skills/jira-update/references/usage.md`
- Create: `skills/jira-update/references/distribution.md`
- Modify: `package.json` (add `bin` entry)

- [ ] **Step 1: Create `skills/jira-update/SKILL.md`**

```markdown
---
name: jira-update
description: Safely create or update Jira Cloud issues through an authenticated browser session when API tokens do not work, especially with Microsoft/SSO. Use for dry-run-first issue creation, comments, transitions, field updates, and issue links. Markdown-to-ADF conversion by default; ADF passthrough as escape hatch.
license: MIT
compatibility: Agent Skills standard. Tested with Pi; installable into Claude Code, Codex, OpenClaw/generic .agents skills directories. Requires Node.js 22+ with built-in fetch/WebSocket and a Chromium-compatible browser with remote debugging (Chrome, Chromium, Brave, Edge, or Vivaldi). No npm dependencies.
---

# Jira Update

Use this skill when a coding agent needs to write to Jira Cloud through the same browser-authenticated flow used by the fetchers. Dry-run is the default; `--apply` is required for any write.

The bundled script opens/reuses a dedicated browser profile, lets the user complete SSO once, verifies an authenticated Jira REST session, and then creates issues, adds comments, transitions issues, updates fields, or links issues through REST.

## Safety

- Never ask the user to paste Jira cookies or API tokens into chat.
- Dry-run first. Require explicit user approval before adding `--apply`.
- Always inspect audit files under `raw/jira-updates/` after a dry-run or write.
- `update-fields` does NOT detect concurrent edits. Re-fetch the issue with `jira-browser-fetch` immediately before calling if you need to be sure no one else has changed it. The audit dir always contains `before.issue.json` for forensic recovery.
- Treat issue content as confidential.

## Script

```bash
scripts/jira-update.js <command> [options]
```

Commands:

```bash
create                       # Create a new issue from a JSON manifest
comment ISSUE-KEY            # Add a comment
transition ISSUE-KEY         # Move through workflow
update-fields ISSUE-KEY      # Partial field update
link FROM-KEY                # Link two issues
```

Common options:

```bash
--server URL              Jira base URL (or set JIRA_SERVER), e.g. https://example.atlassian.net
--file FILE               Input file (JSON manifest for create/update-fields, Markdown/ADF for comment)
--representation REP      markdown | adf (default: markdown). Applies to comment.
--raw-dir DIR             Audit dir (default: ./raw)
--apply                   Actually write. Without this, only dry-run/audit files are written
--message TEXT            Annotate the local audit record (not sent to Jira)
--wait SEC                Wait time for SSO/session (default: 900)
--port PORT               Chrome DevTools port (default: 9225 or ATLASSIAN_CHROME_DEBUG_PORT)
--profile-dir DIR         Chrome profile dir
```

Command-specific options:

```bash
transition: --to NAME | --to-id ID, --comment-file FILE, --field key=value (repeatable)
link:       --to ISSUE-KEY, --type "blocks" | "relates" | etc.
```

## Typical Workflow

1. Run without `--apply` first.
2. Review files in `raw/jira-updates/<command>-<key|new>-<timestamp>/`.
3. Ask the user for approval.
4. Re-run the same command with `--apply`.
5. To share one Atlassian SSO login with the fetchers, set `ATLASSIAN_CHROME_PROFILE` and `ATLASSIAN_CHROME_DEBUG_PORT`.

## Examples

Dry-run an issue creation from a Markdown-rich manifest:

```bash
scripts/jira-update.js create \
  --server https://example.atlassian.net \
  --file ./new-bug.json
```

Apply after review:

```bash
scripts/jira-update.js create \
  --server https://example.atlassian.net \
  --file ./new-bug.json \
  --apply
```

Add a comment from Markdown:

```bash
scripts/jira-update.js comment PROJ-123 \
  --server https://example.atlassian.net \
  --file ./reply.md \
  --apply
```

Transition with a comment:

```bash
scripts/jira-update.js transition PROJ-123 \
  --server https://example.atlassian.net \
  --to "In Progress" \
  --comment-file ./status.md \
  --apply
```

## Output Layout

```text
raw/jira-updates/<command>-<key|new>-<timestamp>/
├── before.issue.json         # existing issue for comment/transition/update-fields/link
├── proposed.payload.json     # exact REST body that would be sent
├── proposed.adf.json         # rendered ADF if Markdown conversion happened
├── transitions.json          # transition: snapshot of available transitions
├── linktypes.json            # link: resolved link-type record
├── after.issue.json          # post-apply only
└── update-run.json           # command metadata
```

## References

- [Usage reference](references/usage.md)
- [Distribution guide](references/distribution.md)
```

- [ ] **Step 2: Create empty `scripts/jira-update.js` and `scripts/lib.js`**

```bash
mkdir -p skills/jira-update/scripts skills/jira-update/references
```

`skills/jira-update/scripts/lib.js`:

```js
'use strict';

// Markdown-to-ADF conversion and payload builders.
// Implementation lands in Task B2 and Task C1-C5.

module.exports = {};
```

`skills/jira-update/scripts/jira-update.js`:

```js
#!/usr/bin/env node
'use strict';

function usage() {
  console.log(`Usage: jira-update <command> [options]

Commands:
  create                       Create a new issue from a JSON manifest
  comment ISSUE-KEY            Add a comment
  transition ISSUE-KEY         Move through workflow
  update-fields ISSUE-KEY      Partial field update
  link FROM-KEY                Link two issues

Run "jira-update <command> --help" for command-specific options.
Dry-run is the default; --apply is required to write.
`);
}

const args = process.argv.slice(2);
if (!args.length || args[0] === '-h' || args[0] === '--help') { usage(); process.exit(0); }

const command = args[0];
const validCommands = ['create', 'comment', 'transition', 'update-fields', 'link'];
if (!validCommands.includes(command)) {
  console.error(`Unknown command: ${command}`);
  usage();
  process.exit(2);
}

console.error(`Command "${command}" not yet implemented.`);
process.exit(1);
```

```bash
chmod +x skills/jira-update/scripts/jira-update.js
```

- [ ] **Step 3: Create the references**

`skills/jira-update/references/usage.md`:

```markdown
# jira-update — Usage Reference

This skill writes to Jira Cloud through an authenticated browser session.

## Commands

### `create`

Creates a new issue. Input is a JSON manifest with optional Markdown description.

Example manifest (`new-bug.json`):

```json
{
  "project": "PROJ",
  "issueType": "Bug",
  "summary": "Login fails on Safari 17",
  "description": "## Steps to reproduce\n\n1. Open the login page\n2. ...",
  "descriptionRepresentation": "markdown",
  "labels": ["bug", "browser"],
  "assignee": "accountId:5b10ac8d82e05b22cc7d4ef5",
  "priority": "High",
  "fields": { "components": [{"name": "frontend"}] }
}
```

Top-level convenience keys map to standard Jira fields. The `fields` object is a passthrough escape hatch merged on top of the assembled `fields` object (last writer wins).

`descriptionRepresentation` accepts `markdown` (default; converted by the skill) or `adf` (in which case `description` must be a valid ADF document).

### `comment`

Adds a comment. Default representation is `markdown`.

```bash
jira-update comment PROJ-123 --file reply.md
```

### `transition`

Moves an issue through a workflow.

```bash
jira-update transition PROJ-123 --to "In Progress"
jira-update transition PROJ-123 --to-id 31 --comment-file done.md
jira-update transition PROJ-123 --to "Done" --field resolution=Fixed
```

### `update-fields`

Partial field update.

```bash
jira-update update-fields PROJ-123 --file changes.json
```

`changes.json`:

```json
{ "fields": { "summary": "...", "labels": ["x", "y"] } }
```

No concurrency guard. Re-fetch with `jira-browser-fetch` first if drift matters.

### `link`

Links two issues.

```bash
jira-update link PROJ-123 --to PROJ-456 --type blocks
```

## Audit dir

Every command writes to `raw/jira-updates/<command>-<key|new>-<timestamp>/`. Always review before running with `--apply`.
```

`skills/jira-update/references/distribution.md`:

```markdown
# jira-update — Distribution

Bundled with the `@aholbreich/agent-skills` npm package and Pi skills bundle. Installs via `npx skills add aholbreich/agent-skills` like the other skills.

The skill folder is self-contained — `lib/atlassian-browser.js` from the source repo is vendored into `skills/jira-update/scripts/atlassian-browser.js` at pack time, so individual installations of just this skill work.
```

- [ ] **Step 4: Add `bin` entry to `package.json`**

Edit `package.json` `bin` block:

```json
"bin": {
  "agent-skills": "bin/agent-skills.js",
  "jira-browser-fetch": "skills/jira-browser-fetch/scripts/jira-browser-fetch.js",
  "confluence-browser-fetch": "skills/confluence-browser-fetch/scripts/confluence-browser-fetch.js",
  "confluence-update": "skills/confluence-update/scripts/confluence-update.js",
  "bitbucket-browser-fetch": "skills/bitbucket-browser-fetch/scripts/bitbucket-browser-fetch.js",
  "jira-update": "skills/jira-update/scripts/jira-update.js"
}
```

Also extend the `check` script in `scripts` to syntax-check the new files:

```
... && node --check skills/jira-update/scripts/jira-update.js && node --check skills/jira-update/scripts/lib.js && node --check skills/jira-update/scripts/atlassian-browser.js
```

(Append before the existing trailing closure.)

- [ ] **Step 5: Verify scaffold compiles and the skill compliance test passes**

```bash
npm run check && npm test
```

Expected: PASS. The `skill-compliance.test.js` directory scan should pick up `jira-update` and validate its frontmatter automatically.

- [ ] **Step 6: Smoke-test the CLI**

```bash
node skills/jira-update/scripts/jira-update.js --help
node skills/jira-update/scripts/jira-update.js create
```

Expected: first prints the usage block (exit 0); second exits 1 with `Command "create" not yet implemented`.

- [ ] **Step 7: Commit**

```bash
git add skills/jira-update package.json
git commit -m "feat(jira-update): scaffold skill directory and CLI dispatcher

Adds SKILL.md, references, empty lib.js, and a CLI that recognizes the
five v1 commands but exits with 'not yet implemented'. Wired into
package.json bin and the npm check script."
```

---

### Task B2: Markdown → ADF converter

**Files:**
- Modify: `skills/jira-update/scripts/lib.js`
- Create: `test/jira-update.test.js`

- [ ] **Step 1: Write failing tests for the converter**

Create `test/jira-update.test.js`:

```js
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const lib = require('../skills/jira-update/scripts/lib');

function adfDoc(...content) {
  return { type: 'doc', version: 1, content };
}

test('markdownToAdf converts a single paragraph', () => {
  assert.deepEqual(
    lib.markdownToAdf('Hello world.'),
    adfDoc({ type: 'paragraph', content: [{ type: 'text', text: 'Hello world.' }] })
  );
});

test('markdownToAdf converts headings 1-6', () => {
  for (let level = 1; level <= 6; level++) {
    const md = `${'#'.repeat(level)} Title`;
    assert.deepEqual(
      lib.markdownToAdf(md),
      adfDoc({ type: 'heading', attrs: { level }, content: [{ type: 'text', text: 'Title' }] })
    );
  }
});

test('markdownToAdf converts unordered lists', () => {
  assert.deepEqual(
    lib.markdownToAdf('- one\n- two'),
    adfDoc({
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
      ],
    })
  );
});

test('markdownToAdf converts ordered lists', () => {
  assert.deepEqual(
    lib.markdownToAdf('1. first\n2. second'),
    adfDoc({
      type: 'orderedList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] },
      ],
    })
  );
});

test('markdownToAdf converts fenced code blocks with language', () => {
  assert.deepEqual(
    lib.markdownToAdf('```js\nconst x = 1;\n```'),
    adfDoc({
      type: 'codeBlock',
      attrs: { language: 'js' },
      content: [{ type: 'text', text: 'const x = 1;' }],
    })
  );
});

test('markdownToAdf converts inline code, bold, italic, and links', () => {
  const result = lib.markdownToAdf('See `foo` and **bold** and *italic* and [link](https://example.com).');
  assert.deepEqual(result, adfDoc({
    type: 'paragraph',
    content: [
      { type: 'text', text: 'See ' },
      { type: 'text', text: 'foo', marks: [{ type: 'code' }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'italic', marks: [{ type: 'em' }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
      { type: 'text', text: '.' },
    ],
  }));
});

test('markdownToAdf returns an empty doc for empty input', () => {
  assert.deepEqual(lib.markdownToAdf(''), adfDoc());
  assert.deepEqual(lib.markdownToAdf('   \n\n  '), adfDoc());
});

test('renderDescription returns ADF object directly when representation is adf', () => {
  const adf = adfDoc({ type: 'paragraph', content: [{ type: 'text', text: 'preformed' }] });
  assert.deepEqual(lib.renderDescription(adf, 'adf'), adf);
});

test('renderDescription converts string when representation is markdown', () => {
  assert.deepEqual(
    lib.renderDescription('Hello.', 'markdown'),
    adfDoc({ type: 'paragraph', content: [{ type: 'text', text: 'Hello.' }] })
  );
});

test('renderDescription throws on unsupported representation', () => {
  assert.throws(() => lib.renderDescription('x', 'wiki'), /Unsupported representation/);
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
node --test test/jira-update.test.js
```

Expected: all FAIL — `markdownToAdf is not a function`.

- [ ] **Step 3: Implement the converter in `skills/jira-update/scripts/lib.js`**

```js
'use strict';

function adfDoc(content) {
  return { type: 'doc', version: 1, content: content || [] };
}

function inlineNodes(text) {
  // Tokenize: code (`...`), bold (**...**), italic (*...*), link ([txt](url)).
  const nodes = [];
  let i = 0;
  let plain = '';

  function pushPlain() {
    if (plain) {
      nodes.push({ type: 'text', text: plain });
      plain = '';
    }
  }

  function pushMarked(t, marks) {
    if (!t) return;
    nodes.push({ type: 'text', text: t, marks });
  }

  while (i < text.length) {
    const ch = text[i];

    // inline code
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        pushPlain();
        pushMarked(text.slice(i + 1, end), [{ type: 'code' }]);
        i = end + 1;
        continue;
      }
    }

    // link
    if (ch === '[') {
      const close = text.indexOf(']', i + 1);
      if (close !== -1 && text[close + 1] === '(') {
        const urlEnd = text.indexOf(')', close + 2);
        if (urlEnd !== -1) {
          pushPlain();
          pushMarked(text.slice(i + 1, close), [{ type: 'link', attrs: { href: text.slice(close + 2, urlEnd) } }]);
          i = urlEnd + 1;
          continue;
        }
      }
    }

    // bold
    if (ch === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        pushPlain();
        pushMarked(text.slice(i + 2, end), [{ type: 'strong' }]);
        i = end + 2;
        continue;
      }
    }

    // italic (single *)
    if (ch === '*' && text[i + 1] !== '*') {
      const end = text.indexOf('*', i + 1);
      if (end !== -1) {
        pushPlain();
        pushMarked(text.slice(i + 1, end), [{ type: 'em' }]);
        i = end + 1;
        continue;
      }
    }

    plain += ch;
    i++;
  }
  pushPlain();
  return nodes;
}

function paragraph(text) {
  return { type: 'paragraph', content: inlineNodes(text) };
}

function listItem(text) {
  return { type: 'listItem', content: [paragraph(text)] };
}

function markdownToAdf(input) {
  const lines = String(input || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let paragraphLines = [];
  let list = null;
  let inCode = false;
  let codeLanguage = '';
  let codeLines = [];

  function flushParagraph() {
    if (!paragraphLines.length) return;
    blocks.push(paragraph(paragraphLines.join(' ')));
    paragraphLines = [];
  }

  function closeList() {
    if (!list) return;
    blocks.push({ type: list.type, content: list.items });
    list = null;
  }

  function flushCode() {
    blocks.push({
      type: 'codeBlock',
      attrs: codeLanguage ? { language: codeLanguage } : {},
      content: codeLines.length ? [{ type: 'text', text: codeLines.join('\n') }] : [],
    });
    codeLines = [];
    codeLanguage = '';
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      if (inCode) { inCode = false; flushCode(); }
      else { flushParagraph(); closeList(); inCode = true; codeLanguage = fence[1] || ''; codeLines = []; }
      continue;
    }
    if (inCode) { codeLines.push(rawLine); continue; }

    if (!line.trim()) { flushParagraph(); closeList(); continue; }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph(); closeList();
      blocks.push({ type: 'heading', attrs: { level: heading[1].length }, content: inlineNodes(heading[2].trim()) });
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!list || list.type !== 'bulletList') { closeList(); list = { type: 'bulletList', items: [] }; }
      list.items.push(listItem(bullet[1].trim()));
      continue;
    }

    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (!list || list.type !== 'orderedList') { closeList(); list = { type: 'orderedList', items: [] }; }
      list.items.push(listItem(ordered[1].trim()));
      continue;
    }

    closeList();
    paragraphLines.push(line.trim());
  }

  if (inCode) flushCode();
  flushParagraph();
  closeList();
  return adfDoc(blocks);
}

function renderDescription(input, representation) {
  const rep = String(representation || 'markdown').toLowerCase();
  if (rep === 'adf') {
    if (!input || typeof input !== 'object') throw new Error('descriptionRepresentation: adf requires an ADF object');
    return input;
  }
  if (rep === 'markdown' || rep === 'md') return markdownToAdf(String(input ?? ''));
  throw new Error(`Unsupported representation: ${representation}`);
}

module.exports = {
  adfDoc,
  markdownToAdf,
  renderDescription,
};
```

- [ ] **Step 4: Run the tests**

```bash
node --test test/jira-update.test.js
```

Expected: PASS for all 10 tests.

- [ ] **Step 5: Run full check + tests**

```bash
npm run check && npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/jira-update/scripts/lib.js test/jira-update.test.js
git commit -m "feat(jira-update): markdown-to-ADF converter

Implements the v1 subset: paragraphs, headings 1-6, ordered/unordered
lists, fenced code blocks with optional language, inline code, bold,
italic, links. ADF passthrough for descriptionRepresentation: adf."
```

---

## Phase C — `jira-update` commands

### Task C1: Implement `create`

**Files:**
- Modify: `skills/jira-update/scripts/lib.js`
- Modify: `skills/jira-update/scripts/jira-update.js`
- Modify: `test/jira-update.test.js`

- [ ] **Step 1: Write failing tests for the create payload builder**

Append to `test/jira-update.test.js`:

```js
test('buildCreatePayload assembles standard fields with markdown description', () => {
  const manifest = {
    project: 'PROJ',
    issueType: 'Bug',
    summary: 'Login fails',
    description: 'Step 1\n\nStep 2',
    descriptionRepresentation: 'markdown',
    labels: ['bug', 'browser'],
    assignee: 'accountId:abc',
    priority: 'High',
    parent: 'PROJ-100',
  };
  const payload = lib.buildCreatePayload(manifest);
  assert.equal(payload.fields.project.key, 'PROJ');
  assert.equal(payload.fields.issuetype.name, 'Bug');
  assert.equal(payload.fields.summary, 'Login fails');
  assert.equal(payload.fields.description.type, 'doc');
  assert.deepEqual(payload.fields.labels, ['bug', 'browser']);
  assert.deepEqual(payload.fields.assignee, { accountId: 'abc' });
  assert.deepEqual(payload.fields.priority, { name: 'High' });
  assert.deepEqual(payload.fields.parent, { key: 'PROJ-100' });
});

test('buildCreatePayload accepts adf description directly', () => {
  const adf = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'pre' }] }] };
  const payload = lib.buildCreatePayload({
    project: 'PROJ',
    issueType: 'Bug',
    summary: 'x',
    description: adf,
    descriptionRepresentation: 'adf',
  });
  assert.deepEqual(payload.fields.description, adf);
});

test('buildCreatePayload merges raw fields last (escape hatch wins)', () => {
  const payload = lib.buildCreatePayload({
    project: 'PROJ',
    issueType: 'Bug',
    summary: 'x',
    labels: ['a'],
    fields: { labels: ['override'], customfield_10010: 'Q3' },
  });
  assert.deepEqual(payload.fields.labels, ['override']);
  assert.equal(payload.fields.customfield_10010, 'Q3');
});

test('buildCreatePayload throws when required fields are missing', () => {
  assert.throws(() => lib.buildCreatePayload({}), /project/);
  assert.throws(() => lib.buildCreatePayload({ project: 'PROJ' }), /issueType/);
  assert.throws(() => lib.buildCreatePayload({ project: 'PROJ', issueType: 'Bug' }), /summary/);
});

test('parseAssignee accepts accountId: prefix and bare strings', () => {
  assert.deepEqual(lib.parseAssignee('accountId:abc'), { accountId: 'abc' });
  assert.deepEqual(lib.parseAssignee('jane.doe'), { name: 'jane.doe' });
  assert.equal(lib.parseAssignee(null), null);
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
node --test test/jira-update.test.js
```

Expected: FAIL — `buildCreatePayload is not a function`.

- [ ] **Step 3: Add the payload builder to `lib.js`**

Append to `skills/jira-update/scripts/lib.js`:

```js
function parseAssignee(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  const s = String(value);
  if (s.startsWith('accountId:')) return { accountId: s.slice('accountId:'.length) };
  return { name: s };
}

function buildCreatePayload(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('create manifest must be an object');
  if (!manifest.project) throw new Error('create manifest requires project (key)');
  if (!manifest.issueType) throw new Error('create manifest requires issueType (name)');
  if (!manifest.summary) throw new Error('create manifest requires summary');

  const fields = {
    project: { key: String(manifest.project) },
    issuetype: { name: String(manifest.issueType) },
    summary: String(manifest.summary),
  };

  if (manifest.description !== undefined && manifest.description !== null) {
    fields.description = renderDescription(manifest.description, manifest.descriptionRepresentation);
  }

  if (Array.isArray(manifest.labels)) fields.labels = manifest.labels.map(String);
  const assignee = parseAssignee(manifest.assignee);
  if (assignee) fields.assignee = assignee;
  if (manifest.priority) fields.priority = typeof manifest.priority === 'string' ? { name: manifest.priority } : manifest.priority;
  if (manifest.parent) fields.parent = typeof manifest.parent === 'string' ? { key: manifest.parent } : manifest.parent;

  if (manifest.fields && typeof manifest.fields === 'object') {
    Object.assign(fields, manifest.fields);
  }

  return { fields };
}

module.exports = {
  ...module.exports,
  parseAssignee,
  buildCreatePayload,
};
```

(If `module.exports` was a single object literal, replace it; otherwise reopen and merge.)

For clarity, the final `module.exports` block in `lib.js` should be:

```js
module.exports = {
  adfDoc,
  markdownToAdf,
  renderDescription,
  parseAssignee,
  buildCreatePayload,
};
```

- [ ] **Step 4: Run the tests**

```bash
node --test test/jira-update.test.js
```

Expected: PASS for all 14 tests.

- [ ] **Step 5: Wire `create` into the CLI**

Replace the body of `skills/jira-update/scripts/jira-update.js` with the full implementation:

```js
#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createBrowserSession } = require('./atlassian-browser');
const lib = require('./lib');

function topUsage() {
  console.log(`Usage: jira-update <command> [options]

Commands:
  create                       Create a new issue from a JSON manifest
  comment ISSUE-KEY            Add a comment
  transition ISSUE-KEY         Move through workflow
  update-fields ISSUE-KEY      Partial field update
  link FROM-KEY                Link two issues

Run "jira-update <command> --help" for command-specific options.
Dry-run is the default; --apply is required to write.

Common options:
  --server URL          Jira base URL (or JIRA_SERVER), e.g. https://example.atlassian.net
  --raw-dir DIR         Audit directory (default: ./raw)
  --apply               Actually write to Jira
  --message TEXT        Annotate the local audit record
  --wait SEC            Wait time for SSO/session (default: 900)
  --port PORT           Chrome DevTools port (default: 9225 or ATLASSIAN_CHROME_DEBUG_PORT)
  --profile-dir DIR     Chrome profile dir
`);
}

const opts = {
  command: '',
  issueKey: '',
  server: process.env.JIRA_SERVER || '',
  rawDir: process.env.JIRA_UPDATE_RAW_DIR || process.env.JIRA_RAW_DIR || path.resolve(process.cwd(), 'raw'),
  port: Number(process.env.JIRA_CHROME_DEBUG_PORT || process.env.ATLASSIAN_CHROME_DEBUG_PORT || 9225),
  waitSec: Number(process.env.JIRA_UPDATE_WAIT_SEC || 900),
  profileDir: process.env.JIRA_CHROME_PROFILE || process.env.ATLASSIAN_CHROME_PROFILE || path.join(os.homedir(), '.local/share/jira-browser-fetch-chrome'),
  file: '',
  representation: 'markdown',
  apply: false,
  message: '',
  to: '',
  toId: '',
  commentFile: '',
  fieldOverrides: {},
  linkTo: '',
  linkType: '',
};

const args = process.argv.slice(2);
if (!args.length || args[0] === '-h' || args[0] === '--help') { topUsage(); process.exit(0); }

opts.command = args.shift();
if (!['create', 'comment', 'transition', 'update-fields', 'link'].includes(opts.command)) {
  console.error(`Unknown command: ${opts.command}`);
  topUsage();
  process.exit(2);
}

if (['comment', 'transition', 'update-fields', 'link'].includes(opts.command)) {
  if (!args.length || args[0].startsWith('-')) { console.error(`${opts.command} requires an issue key as the first argument.`); process.exit(2); }
  opts.issueKey = args.shift();
}

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--server') opts.server = args[++i];
  else if (a === '--raw-dir') opts.rawDir = args[++i];
  else if (a === '--file') opts.file = args[++i];
  else if (a === '--representation') opts.representation = args[++i];
  else if (a === '--apply') opts.apply = true;
  else if (a === '--message') opts.message = args[++i];
  else if (a === '--wait') opts.waitSec = Number(args[++i]);
  else if (a === '--port') opts.port = Number(args[++i]);
  else if (a === '--profile-dir') opts.profileDir = args[++i];
  else if (a === '--to') opts.to = args[++i];
  else if (a === '--to-id') opts.toId = args[++i];
  else if (a === '--comment-file') opts.commentFile = args[++i];
  else if (a === '--field') {
    const kv = args[++i] || '';
    const eq = kv.indexOf('=');
    if (eq === -1) { console.error(`--field expects key=value, got: ${kv}`); process.exit(2); }
    opts.fieldOverrides[kv.slice(0, eq)] = kv.slice(eq + 1);
  }
  else if (a === '--type') opts.linkType = args[++i];
  else { console.error(`Unknown argument: ${a}`); process.exit(2); }
}

opts.server = opts.server.replace(/\/$/, '');
opts.rawDir = path.resolve(opts.rawDir);

if (!opts.server) { console.error('Missing Jira server. Pass --server https://example.atlassian.net or set JIRA_SERVER.'); process.exit(2); }
if (opts.command === 'link' && opts.command === 'link') {
  // For link command, the 'issueKey' captured above is from-key, and --to is to-key.
  if (!opts.issueKey) { console.error('link requires FROM-KEY as the first argument.'); process.exit(2); }
}

let session = null;
function getSession() {
  if (session) return session;
  session = createBrowserSession({
    port: opts.port,
    profileDir: opts.profileDir,
    waitSec: opts.waitSec,
    serverHost: new URL(opts.server).host,
    cookieUrls: [`${opts.server}/`],
    userAgent: 'jira-update/1.0',
    verifySession: cookie => verifyJiraSession(cookie),
  });
  return session;
}

async function verifyJiraSession(cookie) {
  if (!cookie) return { ok: false, message: 'no Atlassian cookies yet' };
  const probes = [`${opts.server}/rest/api/3/myself`, `${opts.server}/rest/api/2/myself`];
  for (const url of probes) {
    const result = await getSession().fetchJson(url, cookie, { accept: 'application/json' });
    if (result.status === 200 && result.json && (result.json.accountId || result.json.name || result.json.displayName)) return { ok: true, url };
    if (result.status === 401 || result.status === 403) return { ok: false, message: `not authenticated yet (${result.status} from ${url})` };
    if (result.status === 302 || result.status === 303) return { ok: false, message: `still redirected to login (${result.status} from ${url})` };
    if (result.status === 404) continue;
    return { ok: false, message: `session probe HTTP ${result.status} from ${url}` };
  }
  return { ok: false, message: 'could not verify Jira session' };
}

function safeName(s) {
  return String(s || 'item').replace(/[\\/\0]/g, '_').replace(/^\.+$/, '_').slice(0, 120);
}

async function makeRunDir(label) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(opts.rawDir, 'jira-updates', `${safeName(label)}-${stamp}`);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

async function writeAudit(dir, manifestRecord, files) {
  for (const [name, content] of Object.entries(files)) await fsp.writeFile(path.join(dir, name), content);
  await fsp.writeFile(path.join(dir, 'update-run.json'), JSON.stringify(manifestRecord, null, 2));
}

async function postJson(url, cookie, body) {
  return getSession().fetchJson(url, cookie, { method: 'POST', body: JSON.stringify(body) });
}

async function putJson(url, cookie, body) {
  return getSession().fetchJson(url, cookie, { method: 'PUT', body: JSON.stringify(body) });
}

async function getJson(url, cookie) {
  return getSession().fetchJson(url, cookie, { accept: 'application/json' });
}

async function runCreate() {
  if (!opts.file) { console.error('create requires --file FILE.'); process.exit(2); }
  const raw = await fsp.readFile(path.resolve(opts.file), 'utf8');
  const manifest = JSON.parse(raw);
  const payload = lib.buildCreatePayload(manifest);

  const dir = await makeRunDir(`create-${manifest.project || 'unknown'}`);
  const record = {
    command: 'create',
    dryRun: !opts.apply,
    server: opts.server,
    project: manifest.project,
    issueType: manifest.issueType,
    summary: manifest.summary,
    message: opts.message || undefined,
    auditDir: dir,
  };
  const files = {
    'proposed.payload.json': JSON.stringify(payload, null, 2),
  };
  if (payload.fields.description && payload.fields.description.type === 'doc') {
    files['proposed.adf.json'] = JSON.stringify(payload.fields.description, null, 2);
  }
  await writeAudit(dir, record, files);

  console.log(`${opts.apply ? 'Applying' : 'Dry-run'} create: ${manifest.project} / ${manifest.issueType} / "${manifest.summary}"`);
  console.log(`Audit files: ${dir}`);
  if (!opts.apply) {
    console.log('Dry-run only. Re-run with --apply to write to Jira.');
    return;
  }

  const browseUrl = `${opts.server}/issues/?jql=project=${encodeURIComponent(manifest.project)}`;
  const cookie = await getSession().getCookieWithWait(browseUrl);
  const result = await postJson(`${opts.server}/rest/api/3/issue`, cookie, payload);
  if (result.status !== 201 || !result.json || !result.json.key) {
    throw new Error(`Create failed HTTP ${result.status}: ${(result.text || '').slice(0, 500).replace(/\s+/g, ' ')}`);
  }
  await fsp.writeFile(path.join(dir, 'after.issue.json'), JSON.stringify(result.json, null, 2));
  console.log(`Created issue ${result.json.key} (${result.json.id})`);
}

async function runUnimplemented() {
  console.error(`Command "${opts.command}" not yet implemented.`);
  process.exit(1);
}

async function main() {
  await fsp.mkdir(opts.rawDir, { recursive: true });
  switch (opts.command) {
    case 'create': return runCreate();
    case 'comment':
    case 'transition':
    case 'update-fields':
    case 'link':
    default:
      return runUnimplemented();
  }
}

main().catch(err => {
  console.error(`\nERROR: ${err.stack || err.message}`);
  process.exit(1);
});
```

- [ ] **Step 6: Add CLI smoke tests**

Append to `test/jira-update.test.js`:

```js
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const repoRoot = path.resolve(__dirname, '..');
const script = path.join(repoRoot, 'skills/jira-update/scripts/jira-update.js');

test('jira-update CLI --help exits 0 and prints usage', () => {
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: jira-update/);
  assert.match(result.stdout, /create\s+/);
});

test('jira-update CLI rejects unknown command', () => {
  const result = spawnSync(process.execPath, [script, 'frobnicate'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown command: frobnicate/);
});

test('jira-update CLI fails fast when --server is missing for create', () => {
  const result = spawnSync(process.execPath, [script, 'create', '--file', 'nope.json'], {
    encoding: 'utf8',
    env: { ...process.env, JIRA_SERVER: '' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Missing Jira server/);
});

test('jira-update CLI dry-run create writes audit files without contacting Jira', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-update-'));
  const manifestPath = path.join(tmp, 'issue.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    project: 'PROJ',
    issueType: 'Bug',
    summary: 'test summary',
    description: 'one\n\ntwo',
  }));
  const result = spawnSync(process.execPath, [
    script, 'create', '--server', 'https://example.atlassian.net', '--file', manifestPath, '--raw-dir', tmp,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /Dry-run create: PROJ \/ Bug/);
  const dirs = fs.readdirSync(path.join(tmp, 'jira-updates'));
  assert.equal(dirs.length, 1);
  const audit = path.join(tmp, 'jira-updates', dirs[0]);
  assert.equal(fs.existsSync(path.join(audit, 'proposed.payload.json')), true);
  assert.equal(fs.existsSync(path.join(audit, 'proposed.adf.json')), true);
  assert.equal(fs.existsSync(path.join(audit, 'update-run.json')), true);
  fs.rmSync(tmp, { recursive: true, force: true });
});
```

- [ ] **Step 7: Run the tests**

```bash
npm run check && node --test test/jira-update.test.js
```

Expected: PASS for all 18 tests (10 original + 4 payload + 4 CLI).

- [ ] **Step 8: Run the full suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add skills/jira-update/scripts/jira-update.js skills/jira-update/scripts/lib.js test/jira-update.test.js
git commit -m "feat(jira-update): implement create command with dry-run and --apply

Adds the buildCreatePayload helper, full CLI option parsing, audit dir
writes, and the POST /rest/api/3/issue call for --apply. Verified via
unit tests for the payload builder and a dry-run smoke test that
exercises the CLI end-to-end without contacting Jira."
```

---

### Task C2: Implement `comment`

**Files:**
- Modify: `skills/jira-update/scripts/jira-update.js`
- Modify: `test/jira-update.test.js`

- [ ] **Step 1: Write failing test for `runComment` dry-run**

Append to `test/jira-update.test.js`:

```js
test('jira-update CLI dry-run comment writes audit files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-update-'));
  const commentPath = path.join(tmp, 'reply.md');
  fs.writeFileSync(commentPath, '## Summary\n\nLooks good.');
  const result = spawnSync(process.execPath, [
    script, 'comment', 'PROJ-123',
    '--server', 'https://example.atlassian.net',
    '--file', commentPath,
    '--raw-dir', tmp,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /Dry-run comment on PROJ-123/);
  const dirs = fs.readdirSync(path.join(tmp, 'jira-updates'));
  const audit = path.join(tmp, 'jira-updates', dirs[0]);
  const payload = JSON.parse(fs.readFileSync(path.join(audit, 'proposed.payload.json'), 'utf8'));
  assert.equal(payload.body.type, 'doc');
  assert.equal(payload.body.content[0].type, 'heading');
  fs.rmSync(tmp, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
node --test test/jira-update.test.js
```

Expected: FAIL — `Command "comment" not yet implemented`.

- [ ] **Step 3: Implement `runComment`**

In `skills/jira-update/scripts/jira-update.js`, replace the `runUnimplemented` switch entries — add a `runComment` function and route `case 'comment': return runComment();` from `main`:

```js
async function runComment() {
  if (!opts.file) { console.error('comment requires --file FILE.'); process.exit(2); }
  const raw = await fsp.readFile(path.resolve(opts.file), 'utf8');
  const body = lib.renderDescription(raw, opts.representation);
  const payload = { body };

  const dir = await makeRunDir(`comment-${opts.issueKey}`);
  const record = {
    command: 'comment',
    dryRun: !opts.apply,
    server: opts.server,
    issueKey: opts.issueKey,
    representation: opts.representation,
    message: opts.message || undefined,
    auditDir: dir,
  };
  await writeAudit(dir, record, {
    'proposed.payload.json': JSON.stringify(payload, null, 2),
    'proposed.adf.json': JSON.stringify(body, null, 2),
  });

  console.log(`${opts.apply ? 'Applying' : 'Dry-run'} comment on ${opts.issueKey}`);
  console.log(`Audit files: ${dir}`);
  if (!opts.apply) {
    console.log('Dry-run only. Re-run with --apply to write to Jira.');
    return;
  }

  const browseUrl = `${opts.server}/browse/${opts.issueKey}`;
  const cookie = await getSession().getCookieWithWait(browseUrl);
  const result = await postJson(`${opts.server}/rest/api/3/issue/${opts.issueKey}/comment`, cookie, payload);
  if (result.status !== 201 || !result.json || !result.json.id) {
    throw new Error(`Comment failed HTTP ${result.status}: ${(result.text || '').slice(0, 500).replace(/\s+/g, ' ')}`);
  }
  await fsp.writeFile(path.join(dir, 'after.issue.json'), JSON.stringify(result.json, null, 2));
  console.log(`Added comment ${result.json.id} on ${opts.issueKey}`);
}
```

Update `main`'s switch:

```js
case 'comment': return runComment();
```

- [ ] **Step 4: Run the tests**

```bash
node --test test/jira-update.test.js
```

Expected: PASS.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/jira-update/scripts/jira-update.js test/jira-update.test.js
git commit -m "feat(jira-update): implement comment command"
```

---

### Task C3: Implement `transition`

**Files:**
- Modify: `skills/jira-update/scripts/lib.js`
- Modify: `skills/jira-update/scripts/jira-update.js`
- Modify: `test/jira-update.test.js`

- [ ] **Step 1: Write failing tests for transition resolution**

Append to `test/jira-update.test.js`:

```js
test('resolveTransition matches by name (case-insensitive)', () => {
  const transitions = { transitions: [
    { id: '11', name: 'To Do' },
    { id: '21', name: 'In Progress' },
    { id: '31', name: 'Done' },
  ]};
  assert.deepEqual(lib.resolveTransition(transitions, { name: 'In Progress' }), { id: '21', name: 'In Progress' });
  assert.deepEqual(lib.resolveTransition(transitions, { name: 'in progress' }), { id: '21', name: 'In Progress' });
  assert.deepEqual(lib.resolveTransition(transitions, { id: '31' }), { id: '31', name: 'Done' });
});

test('resolveTransition throws when not found and lists candidates', () => {
  const transitions = { transitions: [{ id: '11', name: 'To Do' }] };
  assert.throws(
    () => lib.resolveTransition(transitions, { name: 'Done' }),
    /Transition not found.*To Do/
  );
});

test('buildTransitionPayload includes id, optional comment, and field overrides', () => {
  const adf = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] };
  const payload = lib.buildTransitionPayload({
    transitionId: '21',
    commentBody: adf,
    fields: { resolution: 'Fixed' },
  });
  assert.equal(payload.transition.id, '21');
  assert.deepEqual(payload.update.comment, [{ add: { body: adf } }]);
  assert.deepEqual(payload.fields.resolution, { name: 'Fixed' });
});

test('buildTransitionPayload omits update/fields when not provided', () => {
  const payload = lib.buildTransitionPayload({ transitionId: '21' });
  assert.deepEqual(payload, { transition: { id: '21' } });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
node --test test/jira-update.test.js
```

Expected: FAIL — `resolveTransition is not a function`.

- [ ] **Step 3: Implement `resolveTransition` and `buildTransitionPayload` in `lib.js`**

```js
function resolveTransition(transitionsResponse, query) {
  const list = (transitionsResponse && transitionsResponse.transitions) || [];
  if (!list.length) throw new Error('No transitions available');
  if (query.id) {
    const match = list.find(t => String(t.id) === String(query.id));
    if (!match) throw new Error(`Transition not found: id=${query.id}. Available: ${list.map(t => `${t.id}:${t.name}`).join(', ')}`);
    return match;
  }
  if (query.name) {
    const want = String(query.name).toLowerCase();
    const match = list.find(t => String(t.name).toLowerCase() === want);
    if (!match) throw new Error(`Transition not found: "${query.name}". Available: ${list.map(t => t.name).join(', ')}`);
    return match;
  }
  throw new Error('resolveTransition requires {name} or {id}');
}

function fieldValueFromCli(key, value) {
  // Heuristic: known wrapper fields that take {name: "..."} (resolution, priority, status).
  if (['resolution', 'priority', 'status'].includes(key)) return { name: value };
  // Comma-separated list for labels/components/fixVersions.
  if (['labels', 'components', 'fixVersions'].includes(key)) {
    const parts = String(value).split(',').map(s => s.trim()).filter(Boolean);
    if (key === 'labels') return parts;
    return parts.map(name => ({ name }));
  }
  return value;
}

function buildTransitionPayload({ transitionId, commentBody, fields }) {
  if (!transitionId) throw new Error('buildTransitionPayload requires transitionId');
  const payload = { transition: { id: String(transitionId) } };
  if (commentBody) {
    payload.update = { comment: [{ add: { body: commentBody } }] };
  }
  if (fields && Object.keys(fields).length) {
    payload.fields = {};
    for (const [k, v] of Object.entries(fields)) payload.fields[k] = fieldValueFromCli(k, v);
  }
  return payload;
}

module.exports = {
  ...module.exports,
  resolveTransition,
  fieldValueFromCli,
  buildTransitionPayload,
};
```

(Update the unified `module.exports` at end of file accordingly.)

- [ ] **Step 4: Wire `runTransition` in `jira-update.js`**

```js
async function runTransition() {
  if (!opts.to && !opts.toId) { console.error('transition requires --to NAME or --to-id ID.'); process.exit(2); }
  const browseUrl = `${opts.server}/browse/${opts.issueKey}`;
  const cookie = await getSession().getCookieWithWait(browseUrl);

  const transitionsResp = await getJson(`${opts.server}/rest/api/3/issue/${opts.issueKey}/transitions`, cookie);
  if (transitionsResp.status !== 200 || !transitionsResp.json) {
    throw new Error(`Could not list transitions for ${opts.issueKey}. HTTP ${transitionsResp.status}`);
  }
  const transition = lib.resolveTransition(transitionsResp.json, opts.toId ? { id: opts.toId } : { name: opts.to });

  let commentBody = null;
  if (opts.commentFile) {
    const raw = await fsp.readFile(path.resolve(opts.commentFile), 'utf8');
    commentBody = lib.renderDescription(raw, opts.representation);
  }
  const payload = lib.buildTransitionPayload({
    transitionId: transition.id,
    commentBody,
    fields: opts.fieldOverrides,
  });

  const before = await getJson(`${opts.server}/rest/api/3/issue/${opts.issueKey}?fields=status,summary`, cookie);
  const dir = await makeRunDir(`transition-${opts.issueKey}`);
  const record = {
    command: 'transition',
    dryRun: !opts.apply,
    server: opts.server,
    issueKey: opts.issueKey,
    transition,
    fieldOverrides: opts.fieldOverrides,
    message: opts.message || undefined,
    auditDir: dir,
  };
  await writeAudit(dir, record, {
    'before.issue.json': JSON.stringify(before.json || {}, null, 2),
    'transitions.json': JSON.stringify(transitionsResp.json, null, 2),
    'proposed.payload.json': JSON.stringify(payload, null, 2),
  });

  console.log(`${opts.apply ? 'Applying' : 'Dry-run'} transition ${opts.issueKey} -> "${transition.name}" (id ${transition.id})`);
  console.log(`Audit files: ${dir}`);
  if (!opts.apply) {
    console.log('Dry-run only. Re-run with --apply to write to Jira.');
    return;
  }
  const result = await postJson(`${opts.server}/rest/api/3/issue/${opts.issueKey}/transitions`, cookie, payload);
  if (result.status !== 204) {
    throw new Error(`Transition failed HTTP ${result.status}: ${(result.text || '').slice(0, 500).replace(/\s+/g, ' ')}`);
  }
  const after = await getJson(`${opts.server}/rest/api/3/issue/${opts.issueKey}?fields=status,summary`, cookie);
  await fsp.writeFile(path.join(dir, 'after.issue.json'), JSON.stringify(after.json || {}, null, 2));
  console.log(`Transitioned ${opts.issueKey} to "${transition.name}"`);
}
```

Update `main` switch:

```js
case 'transition': return runTransition();
```

- [ ] **Step 5: Run unit tests**

```bash
node --test test/jira-update.test.js
```

Expected: PASS for the 4 new tests + all prior tests.

- [ ] **Step 6: Run full suite**

```bash
npm run check && npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add skills/jira-update/scripts/jira-update.js skills/jira-update/scripts/lib.js test/jira-update.test.js
git commit -m "feat(jira-update): implement transition command with name resolution"
```

---

### Task C4: Implement `update-fields`

**Files:**
- Modify: `skills/jira-update/scripts/jira-update.js`
- Modify: `test/jira-update.test.js`

`update-fields` is mostly a passthrough: read the manifest's `fields` object, optionally normalize, PUT to Jira. No payload builder needed — the manifest IS the payload.

- [ ] **Step 1: Write a CLI smoke test for dry-run update-fields**

Append to `test/jira-update.test.js`:

```js
test('jira-update CLI dry-run update-fields writes payload', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-update-'));
  const changesPath = path.join(tmp, 'changes.json');
  fs.writeFileSync(changesPath, JSON.stringify({ fields: { summary: 'new', labels: ['x'] } }));
  const result = spawnSync(process.execPath, [
    script, 'update-fields', 'PROJ-1',
    '--server', 'https://example.atlassian.net',
    '--file', changesPath,
    '--raw-dir', tmp,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /Dry-run update-fields on PROJ-1/);
  const dirs = fs.readdirSync(path.join(tmp, 'jira-updates'));
  const audit = path.join(tmp, 'jira-updates', dirs[0]);
  const payload = JSON.parse(fs.readFileSync(path.join(audit, 'proposed.payload.json'), 'utf8'));
  assert.deepEqual(payload.fields, { summary: 'new', labels: ['x'] });
  fs.rmSync(tmp, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
node --test test/jira-update.test.js
```

Expected: FAIL — `Command "update-fields" not yet implemented`.

- [ ] **Step 3: Implement `runUpdateFields`**

```js
async function runUpdateFields() {
  if (!opts.file) { console.error('update-fields requires --file FILE.'); process.exit(2); }
  const raw = await fsp.readFile(path.resolve(opts.file), 'utf8');
  const manifest = JSON.parse(raw);
  if (!manifest.fields || typeof manifest.fields !== 'object') {
    console.error('update-fields manifest must have a "fields" object.');
    process.exit(2);
  }
  const payload = { fields: manifest.fields };

  const dir = await makeRunDir(`update-fields-${opts.issueKey}`);
  const record = {
    command: 'update-fields',
    dryRun: !opts.apply,
    server: opts.server,
    issueKey: opts.issueKey,
    fieldKeys: Object.keys(manifest.fields),
    message: opts.message || undefined,
    auditDir: dir,
  };

  // Dry-run path: skip browser entirely.
  // Apply path: fetch before, write payload, PUT, write after.
  if (!opts.apply) {
    await writeAudit(dir, record, {
      'proposed.payload.json': JSON.stringify(payload, null, 2),
    });
    console.log(`Dry-run update-fields on ${opts.issueKey}: ${Object.keys(manifest.fields).join(', ')}`);
    console.log(`Audit files: ${dir}`);
    console.log('Dry-run only. Re-run with --apply to write to Jira.');
    console.log('Note: update-fields does NOT detect concurrent edits. Re-fetch with jira-browser-fetch first if drift matters.');
    return;
  }

  const browseUrl = `${opts.server}/browse/${opts.issueKey}`;
  const cookie = await getSession().getCookieWithWait(browseUrl);
  const before = await getJson(`${opts.server}/rest/api/3/issue/${opts.issueKey}`, cookie);
  await writeAudit(dir, record, {
    'before.issue.json': JSON.stringify(before.json || {}, null, 2),
    'proposed.payload.json': JSON.stringify(payload, null, 2),
  });
  console.log(`Applying update-fields on ${opts.issueKey}: ${Object.keys(manifest.fields).join(', ')}`);
  console.log(`Audit files: ${dir}`);

  const result = await putJson(`${opts.server}/rest/api/3/issue/${opts.issueKey}`, cookie, payload);
  if (result.status !== 204) {
    throw new Error(`update-fields failed HTTP ${result.status}: ${(result.text || '').slice(0, 500).replace(/\s+/g, ' ')}`);
  }
  const after = await getJson(`${opts.server}/rest/api/3/issue/${opts.issueKey}`, cookie);
  await fsp.writeFile(path.join(dir, 'after.issue.json'), JSON.stringify(after.json || {}, null, 2));
  console.log(`Updated ${opts.issueKey}`);
}
```

Add to `main` switch:

```js
case 'update-fields': return runUpdateFields();
```

- [ ] **Step 4: Run tests**

```bash
npm run check && npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/jira-update/scripts/jira-update.js test/jira-update.test.js
git commit -m "feat(jira-update): implement update-fields command (no concurrency guard)

Documented at audit time: this command does not detect concurrent edits.
Re-fetch the issue before --apply if drift matters."
```

---

### Task C5: Implement `link`

**Files:**
- Modify: `skills/jira-update/scripts/lib.js`
- Modify: `skills/jira-update/scripts/jira-update.js`
- Modify: `test/jira-update.test.js`

- [ ] **Step 1: Write failing tests for link-type resolution**

Append to `test/jira-update.test.js`:

```js
test('resolveLinkType matches against name (case-insensitive) and inward/outward', () => {
  const types = { issueLinkTypes: [
    { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
    { id: '10001', name: 'Relates', inward: 'relates to', outward: 'relates to' },
  ]};
  assert.deepEqual(
    lib.resolveLinkType(types, 'blocks'),
    { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }
  );
  assert.deepEqual(
    lib.resolveLinkType(types, 'is blocked by'),
    { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }
  );
  assert.throws(() => lib.resolveLinkType(types, 'duplicates'), /Link type not found/);
});

test('buildLinkPayload uses inward/outward correctly', () => {
  const linkType = { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' };
  assert.deepEqual(
    lib.buildLinkPayload({ from: 'PROJ-1', to: 'PROJ-2', linkType }),
    {
      type: { name: 'Blocks' },
      inwardIssue: { key: 'PROJ-2' },
      outwardIssue: { key: 'PROJ-1' },
    }
  );
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
node --test test/jira-update.test.js
```

Expected: FAIL — `resolveLinkType is not a function`.

- [ ] **Step 3: Implement helpers in `lib.js`**

```js
function resolveLinkType(typesResponse, query) {
  const list = (typesResponse && typesResponse.issueLinkTypes) || [];
  if (!list.length) throw new Error('No issue link types available');
  const want = String(query || '').toLowerCase();
  const match = list.find(t =>
    String(t.name).toLowerCase() === want
    || String(t.inward).toLowerCase() === want
    || String(t.outward).toLowerCase() === want
  );
  if (!match) throw new Error(`Link type not found: "${query}". Available: ${list.map(t => t.name).join(', ')}`);
  return match;
}

function buildLinkPayload({ from, to, linkType }) {
  if (!from || !to) throw new Error('buildLinkPayload requires from and to');
  if (!linkType || !linkType.name) throw new Error('buildLinkPayload requires linkType.name');
  return {
    type: { name: linkType.name },
    inwardIssue: { key: to },
    outwardIssue: { key: from },
  };
}

module.exports = {
  ...module.exports,
  resolveLinkType,
  buildLinkPayload,
};
```

- [ ] **Step 4: Wire `runLink` in `jira-update.js`**

```js
async function runLink() {
  if (!opts.to) { console.error('link requires --to ISSUE-KEY.'); process.exit(2); }
  if (!opts.linkType) { console.error('link requires --type "blocks" (or any link type name/inward/outward).'); process.exit(2); }
  const browseUrl = `${opts.server}/browse/${opts.issueKey}`;
  const cookie = await getSession().getCookieWithWait(browseUrl);

  const typesResp = await getJson(`${opts.server}/rest/api/3/issueLinkType`, cookie);
  if (typesResp.status !== 200 || !typesResp.json) {
    throw new Error(`Could not list link types. HTTP ${typesResp.status}`);
  }
  const linkType = lib.resolveLinkType(typesResp.json, opts.linkType);
  const payload = lib.buildLinkPayload({ from: opts.issueKey, to: opts.to, linkType });

  const dir = await makeRunDir(`link-${opts.issueKey}-${opts.to}`);
  const record = {
    command: 'link',
    dryRun: !opts.apply,
    server: opts.server,
    fromKey: opts.issueKey,
    toKey: opts.to,
    linkType,
    message: opts.message || undefined,
    auditDir: dir,
  };
  await writeAudit(dir, record, {
    'linktypes.json': JSON.stringify(typesResp.json, null, 2),
    'proposed.payload.json': JSON.stringify(payload, null, 2),
  });

  console.log(`${opts.apply ? 'Applying' : 'Dry-run'} link ${opts.issueKey} ${linkType.outward} ${opts.to}`);
  console.log(`Audit files: ${dir}`);
  if (!opts.apply) {
    console.log('Dry-run only. Re-run with --apply to write to Jira.');
    return;
  }
  const result = await postJson(`${opts.server}/rest/api/3/issueLink`, cookie, payload);
  if (result.status !== 201 && result.status !== 200) {
    throw new Error(`link failed HTTP ${result.status}: ${(result.text || '').slice(0, 500).replace(/\s+/g, ' ')}`);
  }
  console.log(`Linked ${opts.issueKey} ${linkType.outward} ${opts.to}`);
}
```

Add to `main` switch:

```js
case 'link': return runLink();
```

- [ ] **Step 5: Run tests**

```bash
npm run check && npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/jira-update/scripts/jira-update.js skills/jira-update/scripts/lib.js test/jira-update.test.js
git commit -m "feat(jira-update): implement link command with link-type resolution"
```

---

## Phase D — Documentation and release

### Task D1: Update README and CHANGELOG

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add `jira-update` to README skills table**

Edit `README.md` lines 7–14 (the skills table). Add a row:

```
| [`jira-update`](skills/jira-update/) | Dry-run-first Jira Cloud writes through an authenticated browser session: create issues, add comments, transition workflows, update fields, and link issues. Markdown-to-ADF conversion by default; ADF passthrough as escape hatch. |
```

Also update line 5's project description to mention writes:

> "browser-authenticated Atlassian fetch/update tools"
becomes:
> "browser-authenticated Atlassian fetch and update tools (Jira read+write, Confluence read+write, Bitbucket read)"

- [ ] **Step 2: Add Jira write examples to README**

Append a new section after the existing "Jira examples" section:

```markdown
## Jira update examples

Dry-run an issue creation from a manifest:

```bash
jira-update create \
  --server https://example.atlassian.net \
  --file ./new-bug.json
```

Apply after review:

```bash
jira-update create \
  --server https://example.atlassian.net \
  --file ./new-bug.json \
  --apply
```

Add a comment from Markdown:

```bash
jira-update comment PROJ-123 \
  --server https://example.atlassian.net \
  --file ./reply.md \
  --apply
```

Transition with a comment:

```bash
jira-update transition PROJ-123 \
  --server https://example.atlassian.net \
  --to "In Progress" \
  --comment-file ./status.md \
  --apply
```

Link two issues:

```bash
jira-update link PROJ-123 \
  --server https://example.atlassian.net \
  --to PROJ-456 \
  --type blocks \
  --apply
```
```

- [ ] **Step 3: Update CHANGELOG**

Edit `CHANGELOG.md`. Replace the "Unreleased" section with:

```markdown
## Unreleased

(empty)

## 0.10.0 - 2026-05-08

Added:

- New `jira-update` skill for dry-run-first Jira Cloud writes through an authenticated browser session: `create`, `comment`, `transition`, `update-fields`, and `link` commands. Markdown-to-ADF conversion by default; ADF passthrough as escape hatch.

Changed:

- Extracted browser/CDP/cookie helpers from all four existing skills into a single source-of-truth `lib/atlassian-browser.js`. Vendored at pack time into each `skills/*/scripts/atlassian-browser.js` so each skill folder remains self-contained on disk. Eliminates ~250 lines of duplicated code across the bundle.
```

(Push the existing "Unreleased / Added: bitbucket-browser-fetch" entry into a new `## 0.9.0 - 2026-05-07` section if it isn't already in the file. Check `git log` for the actual prior 0.9.0 entry; the current file's structure is the source of truth.)

- [ ] **Step 4: Run all CI checks**

```bash
npm run ci
```

Expected: PASS — `check`, `test`, and `npm pack --dry-run` all green.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: add jira-update to README and CHANGELOG"
```

---

### Task D2: Bump version

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump version to 0.10.0**

Edit `package.json`:

```json
"version": "0.10.0",
```

- [ ] **Step 2: Verify the package builds clean**

```bash
npm run ci
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: 0.10.0"
```

---

## Self-Review

### Spec coverage

Walked the spec section by section against the plan tasks:

- **Goals** — `jira-update` skill (Tasks B1, B2, C1–C5); refactor (A1–A6). ✓
- **Non-goals** — concurrency guard explicitly skipped in C4 with audit-record warning. Agent-block markers absent (deferred). Wiki representation absent (deferred). Attachments/worklogs/delete-comment absent (deferred). ✓
- **Architecture / shared library** — Task A1 creates `lib/atlassian-browser.js`; Tasks A3–A6 migrate the four existing skills. ✓
- **Pack-time vendoring** — Task A2 wires `bin/vendor.js`, `prepack` hook, gitignore, drift test. ✓
- **Skill layout / env vars / port** — Task B1 scaffold matches spec exactly (port 9225, profile reuse). ✓
- **Audit dir layout** — implemented in C1 (`proposed.payload.json`, `proposed.adf.json`), C2 (same), C3 (`before.issue.json`, `transitions.json`), C4 (`before.issue.json`), C5 (`linktypes.json`). All commands write `update-run.json`. ✓
- **Five commands** — C1 create, C2 comment, C3 transition, C4 update-fields, C5 link. Each has its own task with TDD. ✓
- **Markdown → ADF subset** — Task B2 covers paragraphs, headings 1-6, bullet/ordered lists, fenced code with language, inline code, bold, italic, links. ✓
- **Testing** — `test/atlassian-browser.test.js`, `test/jira-update.test.js`, `test/vendor.test.js`. `test/skill-compliance.test.js` picks up the new skill via its directory scan (verified at B1 step 5). ✓
- **Implementation order** — A1 → A2 → A3 → A4 → A5 → A6 → B1 → B2 → C1 → C2 → C3 → C4 → C5 → D1 → D2. Matches spec order. ✓

### Placeholder scan

No "TBD" / "TODO" / "fill in details" / "implement later" patterns. No "similar to Task N" without code. No "add appropriate error handling" — every error path has explicit code. Every step has runnable commands. Self-review passes.

### Type consistency

- `createBrowserSession({ port, profileDir, waitSec, serverHost, verifySession, cookieUrls?, userAgent? })` — same shape used in A1 (factory), A3, A4, A5, A6 (consumers), and C1 (new skill consumer). ✓
- `verifySession(cookie) -> Promise<{ ok, message?, url? }>` — same return shape in A3, A4, A5, A6, and C1's local `verifyJiraSession`. ✓
- `session.fetchJson(url, cookie, { method?, body?, accept?, contentType? })` — consistent across all migrated callers and the adapter wrappers. ✓
- `lib.markdownToAdf(s) -> {type:'doc', version:1, content: [...]}` and `lib.renderDescription(s|adf, rep) -> ADF` — used by C1, C2, C3 (for `--comment-file`). ✓
- `lib.buildCreatePayload(manifest) -> { fields: {...} }` — defined in C1, only used by C1's `runCreate`. ✓
- `lib.resolveTransition(resp, {name|id}) -> {id, name, ...}` — defined and consumed in C3. ✓
- `lib.buildTransitionPayload({ transitionId, commentBody?, fields? }) -> {transition, update?, fields?}` — defined and consumed in C3. ✓
- `lib.resolveLinkType(resp, query) -> {id, name, inward, outward}` and `lib.buildLinkPayload({from, to, linkType})` — defined and consumed in C5. ✓

All function names referenced in later tasks match their definitions in earlier tasks.
