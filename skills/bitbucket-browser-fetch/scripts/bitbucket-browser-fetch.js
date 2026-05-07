#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  parseProjectInput,
  repositoriesApiUrl,
  normalizeRepo,
  safeName,
  repositoriesMarkdown,
  cloneScript,
} = require('./lib');

function usage() {
  console.log(`Usage: bitbucket-browser-fetch <PROJECT_URL> [options]

Fetch Bitbucket Cloud project repository inventory through an authenticated browser session.

Options:
  --workspace NAME          Override workspace parsed from URL
  --project KEY             Override project key parsed from URL
  --raw-dir DIR             Output raw directory (default: BITBUCKET_RAW_DIR or ./raw)
  --pagelen N               Internal API page size (default: 100)
  --wait SEC                Wait time for login/session (default: 900)
  --port PORT               Chrome DevTools port (default: BITBUCKET_CHROME_DEBUG_PORT, ATLASSIAN_CHROME_DEBUG_PORT, or 9224)
  --profile-dir DIR         Chrome profile dir (default: BITBUCKET_CHROME_PROFILE, ATLASSIAN_CHROME_PROFILE, or ~/.local/share/bitbucket-browser-fetch-chrome)
  --help                    Show this help

Examples:
  bitbucket-browser-fetch 'https://bitbucket.org/myneva/workspace/projects/SWI' --raw-dir raw
`);
}

const opts = {
  projectUrl: '',
  workspace: '',
  projectKey: '',
  rawDir: process.env.BITBUCKET_RAW_DIR || path.resolve(process.cwd(), 'raw'),
  port: Number(process.env.BITBUCKET_CHROME_DEBUG_PORT || process.env.ATLASSIAN_CHROME_DEBUG_PORT || 9224),
  waitSec: Number(process.env.BITBUCKET_FETCH_WAIT_SEC || 900),
  profileDir: process.env.BITBUCKET_CHROME_PROFILE || process.env.ATLASSIAN_CHROME_PROFILE || path.join(os.homedir(), '.local/share/bitbucket-browser-fetch-chrome'),
  pagelen: Number(process.env.BITBUCKET_PAGELEN || 100),
};

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-h' || a === '--help') { usage(); process.exit(0); }
  else if (a === '--workspace') opts.workspace = args[++i];
  else if (a === '--project') opts.projectKey = args[++i].toUpperCase();
  else if (a === '--raw-dir') opts.rawDir = args[++i];
  else if (a === '--pagelen') opts.pagelen = Number(args[++i]);
  else if (a === '--wait') opts.waitSec = Number(args[++i]);
  else if (a === '--port') opts.port = Number(args[++i]);
  else if (a === '--profile-dir') opts.profileDir = args[++i];
  else if (!a.startsWith('-') && !opts.projectUrl) opts.projectUrl = a;
  else { console.error(`Unknown argument: ${a}`); process.exit(2); }
}

if (!opts.projectUrl && (!opts.workspace || !opts.projectKey)) { usage(); process.exit(2); }
let project = null;
if (opts.projectUrl) project = parseProjectInput(opts.projectUrl);
else project = { source: '', workspace: opts.workspace, projectKey: opts.projectKey, browseUrl: `https://bitbucket.org/${opts.workspace}/workspace/projects/${opts.projectKey}` };
if (opts.workspace) project.workspace = opts.workspace;
if (opts.projectKey) project.projectKey = opts.projectKey.toUpperCase();
project.browseUrl = `https://bitbucket.org/${project.workspace}/workspace/projects/${project.projectKey}`;
opts.rawDir = path.resolve(opts.rawDir);
opts.pagelen = Math.min(100, Math.max(1, opts.pagelen || 100));

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
  const endpointUrl = `http://127.0.0.1:${opts.port}/json/new?${encodeURIComponent(url)}`;
  for (const init of [{ method: 'PUT' }, {}]) {
    try {
      const res = await fetch(endpointUrl, init);
      if (res.ok) { await sleep(1000); return true; }
    } catch {}
  }
  return false;
}

async function hasBitbucketTab(url) {
  const host = new URL(url).host;
  const list = await endpoint('/json/list');
  return list.some(t => t.type === 'page' && t.url && (() => {
    try { return new URL(t.url).host === host; } catch { return false; }
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
    launchChrome(openUrl);
  } else {
    console.log(`Reusing Chrome DevTools on port ${opts.port}`);
    if (await hasBitbucketTab(openUrl)) console.log(`Found existing Bitbucket tab for ${new URL(openUrl).host}; not opening another tab.`);
    else if (await openDevtoolsTab(openUrl)) console.log(`Opened target URL in reused browser: ${openUrl}`);
    else console.warn('Could not open target URL through DevTools; continuing with existing tabs.');
  }
  await waitDevtools();
}

async function getPageWsUrl() {
  const list = await endpoint('/json/list');
  const pages = list.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
  const preferred = pages.find(t => (t.url || '').includes('bitbucket.org')) || pages[0];
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
    const result = await cdp.send('Network.getCookies', { urls: ['https://bitbucket.org/'] });
    return (result.cookies || [])
      .filter(c => c.domain && (c.domain === 'bitbucket.org' || c.domain.endsWith('.bitbucket.org')))
      .map(c => `${c.name}=${c.value}`)
      .join('; ');
  } finally {
    cdp.close();
  }
}

async function fetchJson(url, cookie) {
  const res = await fetch(url, {
    headers: { Cookie: cookie, Accept: 'application/json', 'User-Agent': 'bitbucket-browser-fetch/1.0' },
    redirect: 'follow',
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, contentType: res.headers.get('content-type') || '', text, json };
}

async function verifyBitbucketSession(cookie) {
  if (!cookie) return { ok: false, message: 'no Bitbucket cookies yet' };
  const url = `https://bitbucket.org/!api/internal/menu/project/${encodeURIComponent(project.workspace)}/${encodeURIComponent(project.projectKey)}`;
  const result = await fetchJson(url, cookie);
  if (result.status === 200 && result.json) return { ok: true, url };
  if (result.status === 401 || result.status === 403 || result.status === 404) {
    return { ok: false, message: `not authenticated or no project access (${result.status} from ${url})` };
  }
  return { ok: false, message: `session probe HTTP ${result.status} from ${url}` };
}

async function getCookieWithWait() {
  await ensureBrowser(project.browseUrl);
  console.log(`If prompted in Chrome, complete Bitbucket/Atlassian login for: ${project.browseUrl}`);
  const deadline = Date.now() + opts.waitSec * 1000;
  let last = '';
  let printedWait = false;
  while (Date.now() < deadline) {
    try {
      const cookie = await getCookieHeader();
      const session = await verifyBitbucketSession(cookie);
      if (session.ok) {
        if (process.stdout.isTTY) process.stdout.write('\n');
        console.log(`Authenticated Bitbucket session verified via ${session.url}`);
        return cookie;
      }
      last = session.message;
    } catch (e) { last = e.message; }
    if (process.stdout.isTTY) process.stdout.write(`\r${new Date().toLocaleTimeString()} ${last.padEnd(120).slice(0, 120)}`);
    else if (!printedWait) { console.log(`Waiting up to ${opts.waitSec}s for Bitbucket session...`); printedWait = true; }
    await sleep(3000);
  }
  if (process.stdout.isTTY) process.stdout.write('\n');
  throw new Error(`Could not verify authenticated Bitbucket session. Last result: ${last}`);
}

async function fetchRepositories(cookie) {
  const pages = [];
  const repos = [];
  let page = 1;
  let nextUrl = repositoriesApiUrl(project.workspace, project.projectKey, page, opts.pagelen);
  while (nextUrl) {
    const result = await fetchJson(nextUrl, cookie);
    if (result.status !== 200 || !result.json || !Array.isArray(result.json.values)) {
      throw new Error(`Repository list failed HTTP ${result.status}: ${(result.text || '').slice(0, 500).replace(/\s+/g, ' ')}`);
    }
    pages.push(result.json);
    repos.push(...result.json.values.map(normalizeRepo));
    console.log(`Fetched Bitbucket repositories page ${result.json.page || page}: ${result.json.values.length} repo(s)`);
    nextUrl = result.json.next || '';
    page += 1;
  }
  return { pages, repos };
}

async function main() {
  await fsp.mkdir(opts.rawDir, { recursive: true });
  const cookie = await getCookieWithWait();
  const { pages, repos } = await fetchRepositories(cookie);
  const outDir = path.join(opts.rawDir, 'bitbucket', safeName(project.workspace), 'projects', safeName(project.projectKey));
  await fsp.mkdir(path.join(outDir, 'pages'), { recursive: true });

  const manifest = {
    fetchedAt: new Date().toISOString(),
    source: project.source || project.browseUrl,
    browseUrl: project.browseUrl,
    workspace: project.workspace,
    projectKey: project.projectKey,
    repositoryCount: repos.length,
    repositories: repos,
  };

  await fsp.writeFile(path.join(outDir, 'repositories.json'), JSON.stringify(manifest, null, 2));
  await fsp.writeFile(path.join(outDir, 'repositories.md'), repositoriesMarkdown(manifest));
  await fsp.writeFile(path.join(outDir, 'clone-ssh.txt'), repos.map(r => r.clone && r.clone.ssh).filter(Boolean).join('\n') + '\n');
  await fsp.writeFile(path.join(outDir, 'clone-https.txt'), repos.map(r => r.clone && r.clone.https).filter(Boolean).join('\n') + '\n');
  await fsp.writeFile(path.join(outDir, 'clone-ssh.sh'), cloneScript(), { mode: 0o755 });
  for (let i = 0; i < pages.length; i++) {
    await fsp.writeFile(path.join(outDir, 'pages', `repositories-page-${i + 1}.json`), JSON.stringify(pages[i], null, 2));
  }
  const runMeta = { fetchedAt: manifest.fetchedAt, workspace: project.workspace, projectKey: project.projectKey, rawDir: outDir, repositoryCount: repos.length };
  await fsp.writeFile(path.join(outDir, 'bitbucket-browser-fetch-run.json'), JSON.stringify(runMeta, null, 2));

  console.log(`\nFetched ${repos.length} Bitbucket repos for ${project.workspace}/${project.projectKey}`);
  console.log(`Saved ${path.join(outDir, 'repositories.json')}`);
  console.log(`SSH clone list: ${path.join(outDir, 'clone-ssh.txt')}`);
  for (const repo of repos) console.log(`- ${repo.fullName || repo.name}`);
}

main().catch(err => {
  console.error(`\nERROR: ${err.stack || err.message}`);
  process.exit(1);
});
