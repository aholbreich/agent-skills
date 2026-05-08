'use strict';

const fs = require('node:fs');
const path = require('node:path');
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
