#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const lib = require('./lib');
const {
  safeName,
  extractPageId,
  renderContent,
  wrapMacro,
  replaceMarkedBlock,
} = lib;

function usage() {
  console.log(`Usage: confluence-update <command> [options]

Safely update or create Confluence Cloud pages through an authenticated browser session.
Dry-run is the default; pass --apply to write to Confluence.

Commands:
  update PAGE_ID_OR_URL        Replace an existing page body
  replace-block PAGE_ID_OR_URL Replace only a marked agent-owned block
  replace-text PAGE_ID_OR_URL  Replace an exact matched string in the page
  replace-element PAGE_ID_OR_URL Replace an element by its local-id
  create                       Create a new page

Common options:
  --site URL                   Atlassian site base URL (or CONFLUENCE_SITE), e.g. https://example.atlassian.net
  --file FILE                  Input file containing storage XHTML or Markdown
  --representation REP         storage | markdown (default: storage)
  --raw-dir DIR                Output/audit dir (default: CONFLUENCE_UPDATE_RAW_DIR, CONFLUENCE_RAW_DIR, or ./raw)
  --message TEXT               Version message (default: Updated by confluence-update)
  --labels LIST                Comma-separated labels to add/set on the page
  --wrap-macro NAME            Wrap the generated storage in a macro (e.g. page-properties)
  --minor-edit                 Mark update as minor edit (default)
  --major-edit                 Do not mark update as minor edit
  --expected-version N|auto    Fail if current page version is not N. Use 'auto' to always overwrite (default: null)
  --apply                      Actually write. Without this, only dry-run/audit files are written
  --wait SEC                   Wait time for SSO/session (default: 900)
  --port PORT                  Chrome DevTools port (default: CONFLUENCE_CHROME_DEBUG_PORT, ATLASSIAN_CHROME_DEBUG_PORT, or 9224)
  --profile-dir DIR            Chrome profile dir (default: CONFLUENCE_CHROME_PROFILE, ATLASSIAN_CHROME_PROFILE, or ~/.local/share/confluence-browser-fetch-chrome)

Update options:
  --title TITLE                Override page title while updating

replace-block options:
  --marker NAME                Required marker name, e.g. agent-summary for <!-- agent-block:agent-summary:start -->

replace-text options:
  --match TEXT                 Required exact string to find and replace

replace-element options:
  --local-id ID                Required local-id attribute value of the element to replace

Create options:
  --space KEY                  Required Confluence space key
  --title TITLE                Required page title
  --parent-id ID               Parent page id. Required unless --allow-root is passed
  --allow-root                 Allow creating a root page without parent-id

Examples:
  confluence-update update 123456 --site https://example.atlassian.net --file page.storage.html --apply
  confluence-update replace-block 123456 --marker agent-summary --file summary.md --representation markdown --apply
  confluence-update create --site https://example.atlassian.net --space ABC --parent-id 123456 --title 'New Page' --file page.md --representation markdown --apply
`);
}

const opts = {
  command: '',
  pageInput: '',
  site: process.env.CONFLUENCE_SITE || '',
  rawDir: process.env.CONFLUENCE_UPDATE_RAW_DIR || process.env.CONFLUENCE_RAW_DIR || path.resolve(process.cwd(), 'raw'),
  port: Number(process.env.CONFLUENCE_CHROME_DEBUG_PORT || process.env.ATLASSIAN_CHROME_DEBUG_PORT || (process.env.ATLASSIAN_CHROME_PROFILE ? 9223 : 9224)),
  waitSec: Number(process.env.CONFLUENCE_UPDATE_WAIT_SEC || process.env.CONFLUENCE_FETCH_WAIT_SEC || 900),
  profileDir: process.env.CONFLUENCE_CHROME_PROFILE || process.env.ATLASSIAN_CHROME_PROFILE || path.join(os.homedir(), '.local/share/confluence-browser-fetch-chrome'),
  file: '',
  representation: 'storage',
  title: '',
  message: 'Updated by confluence-update',
  wrapMacro: '',
  minorEdit: true,
  labels: [],
  expectedVersion: null,
  apply: false,
  marker: '',
  matchText: '',
  localId: '',
  space: '',
  parentId: '',
  allowRoot: false,
};

const args = process.argv.slice(2);
if (!args.length || args.includes('-h') || args.includes('--help')) { usage(); process.exit(0); }
opts.command = args.shift();
if (!['update', 'replace-block', 'replace-text', 'replace-element', 'create'].includes(opts.command)) {
  console.error(`Unknown command: ${opts.command}`);
  usage();
  process.exit(2);
}
if (opts.command !== 'create') opts.pageInput = args.shift() || '';

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--site') opts.site = args[++i];
  else if (a === '--raw-dir') opts.rawDir = args[++i];
  else if (a === '--file') opts.file = args[++i];
  else if (a === '--representation') opts.representation = args[++i];
  else if (a === '--title') opts.title = args[++i];
  else if (a === '--message') opts.message = args[++i];
  else if (a === '--labels') opts.labels = args[++i].split(',').map(s => s.trim()).filter(Boolean);
  else if (a === '--wrap-macro') opts.wrapMacro = args[++i];
  else if (a === '--minor-edit') opts.minorEdit = true;
  else if (a === '--major-edit') opts.minorEdit = false;
  else if (a === '--expected-version') opts.expectedVersion = args[++i] === 'auto' ? 'auto' : Number(args[i]);
  else if (a === '--apply') opts.apply = true;
  else if (a === '--wait') opts.waitSec = Number(args[++i]);
  else if (a === '--port') opts.port = Number(args[++i]);
  else if (a === '--profile-dir') opts.profileDir = args[++i];
  else if (a === '--marker') opts.marker = args[++i];
  else if (a === '--match') opts.matchText = args[++i];
  else if (a === '--local-id') opts.localId = args[++i];
  else if (a === '--space') opts.space = args[++i];
  else if (a === '--parent-id') opts.parentId = args[++i];
  else if (a === '--allow-root') opts.allowRoot = true;
  else { console.error(`Unknown argument: ${a}`); process.exit(2); }
}

opts.site = opts.site.replace(/\/$/, '');
opts.rawDir = path.resolve(opts.rawDir);
const wikiBase = opts.site ? `${opts.site}/wiki` : '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function failUsage(message) {
  console.error(message);
  process.exit(2);
}

if (!opts.site) failUsage('Missing Atlassian site. Pass --site https://example.atlassian.net or set CONFLUENCE_SITE.');
if (!opts.file) failUsage('Missing --file input.');
if (opts.command !== 'create' && !opts.pageInput) failUsage(`Missing page id or URL for ${opts.command}.`);
if (opts.command === 'replace-block' && !opts.marker) failUsage('replace-block requires --marker NAME.');
if (opts.command === 'replace-text' && !opts.matchText) failUsage('replace-text requires --match TEXT.');
if (opts.command === 'replace-element' && !opts.localId) failUsage('replace-element requires --local-id ID.');
if (opts.command === 'create') {
  if (!opts.space) failUsage('create requires --space KEY.');
  if (!opts.title) failUsage('create requires --title TITLE.');
  if (!opts.parentId && !opts.allowRoot) failUsage('create requires --parent-id ID unless --allow-root is passed.');
}
if (opts.expectedVersion !== null && opts.expectedVersion !== 'auto' && (!Number.isInteger(opts.expectedVersion) || opts.expectedVersion < 1)) failUsage('--expected-version must be "auto" or a positive integer.');

async function endpoint(pathname) {
  const res = await fetch(`http://127.0.0.1:${opts.port}${pathname}`);
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
  const endpointUrl = `http://127.0.0.1:${opts.port}/json/new?${encodeURIComponent(url)}`;
  for (const init of [{ method: 'PUT' }, {}]) {
    try {
      const res = await fetch(endpointUrl, init);
      if (res.ok) { await sleep(500); return true; }
    } catch {}
  }
  return false;
}

async function hasDevtoolsTabForWiki(url) {
  if (!url) return false;
  const host = new URL(url).host;
  const list = await endpoint('/json/list');
  return list.some(t => t.type === 'page' && t.url && (() => {
    try {
      const tabUrl = new URL(t.url);
      return tabUrl.host === host && tabUrl.pathname.startsWith('/wiki');
    } catch { return false; }
  })());
}

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

function launchChrome(url) {
  const browser = findBrowserExecutable();
  const args = [
    `--remote-debugging-port=${opts.port}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*',
    `--user-data-dir=${opts.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    url,
  ];
  console.log(`Launching browser: ${browser}`);
  const child = spawn(browser, args, { detached: true, stdio: 'ignore' });
  child.on('error', err => console.error(`Failed to launch browser ${browser}: ${err.message}`));
  child.unref();
}

async function ensureBrowser(openUrl) {
  if (!(await devtoolsReady())) {
    console.log(`Opening Chromium-compatible browser with reusable profile: ${opts.profileDir}`);
    launchChrome(openUrl || wikiBase);
  } else {
    console.log(`Reusing Chrome DevTools on port ${opts.port}`);
    const targetUrl = openUrl || wikiBase;
    const hasTab = await hasDevtoolsTabForWiki(targetUrl);
    if (hasTab) {
      console.log(`Found existing Confluence tab for ${new URL(targetUrl).host}; not opening another tab.`);
    } else {
      const opened = await openDevtoolsTab(targetUrl);
      if (opened) console.log(`Opened target URL in reused browser: ${targetUrl}`);
      else console.warn('Could not open target URL through DevTools; continuing with existing tabs.');
    }
  }
  await waitDevtools();
}

async function getPageWsUrl() {
  const list = await endpoint('/json/list');
  const pages = list.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
  const host = new URL(opts.site).host;
  const preferred = pages.find(t => (t.url || '').includes(host)) || pages[0];
  return preferred && preferred.webSocketDebuggerUrl;
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

async function getCookieHeader() {
  const wsUrl = await getPageWsUrl();
  if (!wsUrl) return '';
  const cdp = await connectCdp(wsUrl);
  try {
    await cdp.send('Network.enable');
    const host = new URL(opts.site).host;
    const result = await cdp.send('Network.getCookies', { urls: [`${opts.site}/`, wikiBase] });
    const cookies = (result.cookies || [])
      .filter(c => c.domain && (c.domain === host || c.domain.endsWith(`.${host}`)))
      .map(c => `${c.name}=${c.value}`);
    return cookies.join('; ');
  } finally {
    cdp.close();
  }
}

async function fetchText(url, cookie, method = 'GET', body = null) {
  const headers = {
    Cookie: cookie,
    Accept: 'application/json',
    'User-Agent': 'confluence-update/1.0',
  };
  if (body !== null) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, redirect: 'follow', headers, body });
  return { status: res.status, contentType: res.headers.get('content-type') || '', text: await res.text() };
}

async function fetchJson(url, cookie, method = 'GET', json = null) {
  const result = await fetchText(url, cookie, method, json === null ? null : JSON.stringify(json));
  let parsed = null;
  try { parsed = JSON.parse(result.text); } catch {}
  return { ...result, json: parsed };
}

async function verifyConfluenceSession(cookie) {
  if (!cookie) return { ok: false, message: 'no Atlassian cookies yet' };
  const probes = [`${wikiBase}/rest/api/user/current`, `${wikiBase}/rest/api/space?limit=1`];
  for (const url of probes) {
    const result = await fetchJson(url, cookie);
    if (result.status === 200 && result.json) return { ok: true, url };
    if (result.status === 401 || result.status === 403) return { ok: false, message: `not authenticated yet (${result.status} from ${url})` };
    if (result.status === 302 || result.status === 303) return { ok: false, message: `still redirected to login (${result.status} from ${url})` };
    if (result.status === 404) continue;
    return { ok: false, message: `session probe HTTP ${result.status} from ${url}` };
  }
  return { ok: false, message: 'could not verify Confluence session' };
}

async function getCookieWithWait(openUrl) {
  await ensureBrowser(openUrl || wikiBase);
  console.log(`If prompted in Chrome, complete SSO for: ${openUrl || wikiBase}`);
  const deadline = Date.now() + opts.waitSec * 1000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const cookie = await getCookieHeader();
      const session = await verifyConfluenceSession(cookie);
      if (session.ok) {
        if (process.stdout.isTTY) process.stdout.write('\n');
        console.log(`Authenticated Confluence session verified via ${session.url}`);
        return cookie;
      }
      last = session.message;
    } catch (e) { last = e.message; }
    if (process.stdout.isTTY) {
      process.stdout.write(`\r${new Date().toLocaleTimeString()} ${last.padEnd(120).slice(0, 120)}`);
    } else if (Date.now() - deadline + opts.waitSec * 1000 < 4000) {
      console.log(`Waiting up to ${opts.waitSec}s for Confluence session...`);
    }
    await sleep(3000);
  }
  if (process.stdout.isTTY) process.stdout.write('\n');
  throw new Error(`Could not verify authenticated Confluence session. Last result: ${last}`);
}

function pageUrl(pageId) {
  return `${wikiBase}/spaces/pages/${pageId}`;
}

async function getPage(pageId, cookie) {
  const url = `${wikiBase}/rest/api/content/${pageId}?expand=body.storage,version,space,ancestors`;
  const result = await fetchJson(url, cookie);
  if (result.status !== 200 || !result.json || !result.json.id) {
    throw new Error(`Could not read page ${pageId}. HTTP ${result.status}: ${(result.text || '').slice(0, 300).replace(/\s+/g, ' ')}`);
  }
  return result.json;
}

function currentStorage(page) {
  return (((page || {}).body || {}).storage || {}).value || '';
}

function updatePayload(page, storage) {
  const payload = {
    id: String(page.id),
    type: page.type || 'page',
    title: opts.title || page.title,
    space: { key: page.space && page.space.key },
    body: { storage: { value: storage, representation: 'storage' } },
    version: {
      number: Number(page.version && page.version.number || 0) + 1,
      minorEdit: opts.minorEdit,
      message: opts.message,
    },
  };
  if (opts.labels.length > 0) {
    payload.metadata = {
      labels: opts.labels.map(name => ({ prefix: 'global', name }))
    };
  }
  return payload;
}

function createPayload(storage) {
  const payload = {
    type: 'page',
    title: opts.title,
    space: { key: opts.space },
    body: { storage: { value: storage, representation: 'storage' } },
  };
  if (opts.parentId) payload.ancestors = [{ id: String(opts.parentId) }];
  if (opts.labels.length > 0) {
    payload.metadata = {
      labels: opts.labels.map(name => ({ prefix: 'global', name }))
    };
  }
  return payload;
}

async function makeRunDir(name) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(opts.rawDir, 'confluence-updates', `${safeName(name)}-${stamp}`);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

async function writeAudit(dir, manifest, files) {
  for (const [name, content] of Object.entries(files)) await fsp.writeFile(path.join(dir, name), content);
  await fsp.writeFile(path.join(dir, 'update-run.json'), JSON.stringify(manifest, null, 2));
}

async function runUpdate(cookie, pageId, inputStorage) {
  const page = await getPage(pageId, cookie);
  const version = Number(page.version && page.version.number || 0);
  if (opts.expectedVersion !== null && opts.expectedVersion !== 'auto' && version !== opts.expectedVersion) {
    throw new Error(`Version mismatch for ${pageId}: expected ${opts.expectedVersion}, current ${version}. Refetch before updating.`);
  }
  let nextStorage = inputStorage;
  if (opts.command === 'replace-block') nextStorage = replaceMarkedBlock(currentStorage(page), opts.marker, inputStorage);
  else if (opts.command === 'replace-text') nextStorage = lib.replaceTextMatch(currentStorage(page), opts.matchText, inputStorage);
  else if (opts.command === 'replace-element') nextStorage = lib.replaceLocalId(currentStorage(page), opts.localId, inputStorage);

  const payload = updatePayload(page, nextStorage);
  const dir = await makeRunDir(pageId);
  const { generateSimpleDiff } = require('./lib');
  const manifest = {
    command: opts.command,
    dryRun: !opts.apply,
    site: opts.site,
    pageId,
    title: payload.title,
    currentVersion: version,
    nextVersion: payload.version.number,
    representation: opts.representation,
    marker: opts.marker || undefined,
    matchText: opts.matchText || undefined,
    localId: opts.localId || undefined,
    auditDir: dir,
  };
  await writeAudit(dir, manifest, {
    'before.page.json': JSON.stringify(page, null, 2),
    'before.storage.html': currentStorage(page),
    'proposed.storage.html': nextStorage,
    'payload.json': JSON.stringify(payload, null, 2),
  });
  console.log(`${opts.apply ? 'Applying' : 'Dry-run'} ${opts.command} for page ${pageId}: ${page.title} v${version} -> v${payload.version.number}`);
  console.log(`Audit files: ${dir}`);
  
  if (!opts.apply) {
    console.log('\n--- Dry-run Diff Summary ---');
    console.log(generateSimpleDiff(currentStorage(page), nextStorage));
    console.log('----------------------------\n');
    console.log('Dry-run only. Re-run with --apply to write to Confluence.');
    return;
  }
  const result = await fetchJson(`${wikiBase}/rest/api/content/${pageId}`, cookie, 'PUT', payload);
  if (result.status !== 200 || !result.json || !result.json.id) {
    throw new Error(`Update failed HTTP ${result.status}: ${(result.text || '').slice(0, 500).replace(/\s+/g, ' ')}`);
  }
  await fsp.writeFile(path.join(dir, 'after.page.json'), JSON.stringify(result.json, null, 2));
  console.log(`Updated page ${pageId} to version ${result.json.version && result.json.version.number || payload.version.number}`);
}

async function runCreate(cookie, inputStorage) {
  const payload = createPayload(inputStorage);
  const dir = await makeRunDir(`create-${opts.space}-${opts.title}`);
  const manifest = {
    command: 'create',
    dryRun: !opts.apply,
    site: opts.site,
    space: opts.space,
    parentId: opts.parentId || undefined,
    title: opts.title,
    representation: opts.representation,
    auditDir: dir,
  };
  await writeAudit(dir, manifest, {
    'proposed.storage.html': inputStorage,
    'payload.json': JSON.stringify(payload, null, 2),
  });
  console.log(`${opts.apply ? 'Applying' : 'Dry-run'} create page: ${opts.space} / ${opts.title}`);
  console.log(`Audit files: ${dir}`);
  if (!opts.apply) {
    console.log('Dry-run only. Re-run with --apply to write to Confluence.');
    return;
  }
  const result = await fetchJson(`${wikiBase}/rest/api/content`, cookie, 'POST', payload);
  if ((result.status !== 200 && result.status !== 201) || !result.json || !result.json.id) {
    throw new Error(`Create failed HTTP ${result.status}: ${(result.text || '').slice(0, 500).replace(/\s+/g, ' ')}`);
  }
  await fsp.writeFile(path.join(dir, 'after.page.json'), JSON.stringify(result.json, null, 2));
  console.log(`Created page ${result.json.id}: ${result.json.title}`);
}

async function main() {
  const rawInput = await fsp.readFile(path.resolve(opts.file), 'utf8');
  let inputStorage = renderContent(rawInput, opts.representation);
  if (opts.wrapMacro) inputStorage = wrapMacro(inputStorage, opts.wrapMacro);

  const pageId = opts.command === 'create' ? '' : extractPageId(opts.pageInput);
  if (opts.command !== 'create' && !pageId) throw new Error(`Could not extract page id from: ${opts.pageInput}`);
  const openUrl = opts.command === 'create' ? wikiBase : pageUrl(pageId);
  const cookie = await getCookieWithWait(openUrl);
  if (opts.command === 'create') await runCreate(cookie, inputStorage);
  else await runUpdate(cookie, pageId, inputStorage);
}

main().catch(err => {
  console.error(`\nERROR: ${err.stack || err.message}`);
  process.exit(1);
});
