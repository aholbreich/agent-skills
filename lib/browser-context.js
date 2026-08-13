'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const DEFAULT_TEXT_LIMIT = 25 * 1024 * 1024;
const DEFAULT_BINARY_CHUNK = 256 * 1024;

function isExecutable(file) {
  try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; }
}

function resolveExecutable(candidate) {
  if (!candidate) return null;
  if (candidate.includes(path.sep)) return isExecutable(candidate) ? candidate : null;
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, candidate);
    if (isExecutable(full)) return full;
  }
  return null;
}

function findNativeBrowser() {
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
    const resolved = resolveExecutable(candidate);
    if (resolved) return resolved;
  }
  throw new Error('Could not find a native Chromium-compatible browser. Install Chrome/Chromium/Brave/Edge/Vivaldi, set CHROME, or use --browser-backend windows-wsl from WSL.');
}

function isWsl() {
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_INTEROP || process.env.WSL_DISTRO_NAME) return true;
  try { return /microsoft|wsl/i.test(fs.readFileSync('/proc/sys/kernel/osrelease', 'utf8')); } catch {}
  try { return /microsoft|wsl/i.test(fs.readFileSync('/proc/version', 'utf8')); } catch {}
  return false;
}

function selectBrowserBackend(requested = 'auto') {
  if (!['auto', 'native', 'windows-wsl'].includes(requested)) {
    throw new Error(`Unsupported browser backend: ${requested}`);
  }
  if (requested !== 'auto') return requested;
  if (isWsl() && resolveExecutable('powershell.exe')) return 'windows-wsl';
  return 'native';
}

function toWindowsPath(input) {
  if (!isWsl()) return input;
  const result = spawnSync('wslpath', ['-w', input], { encoding: 'utf8', timeout: 5000 });
  if (result.error || result.status !== 0) throw new Error(`Could not convert WSL path for Windows: ${input}`);
  return result.stdout.trim();
}

function validateOrigin(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`Browser-context origin must use HTTPS: ${url.origin}`);
  }
  if (url.username || url.password) throw new Error('Browser-context origin must not contain credentials');
  return url.origin;
}

function validateSameOriginUrl(raw, origin) {
  const expected = validateOrigin(origin);
  const url = new URL(raw, `${expected}/`);
  if (url.origin !== expected) throw new Error(`Refusing cross-origin browser request: ${url.origin} (expected ${expected})`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Unsupported browser request protocol: ${url.protocol}`);
  url.username = '';
  url.password = '';
  return url.href;
}

function connectCdp(webSocketUrl, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    let nextId = 0;
    let settled = false;
    const pending = new Map();
    const connectTimer = setTimeout(() => {
      try { socket.close(); } catch {}
      reject(new Error('CDP WebSocket connection timed out'));
    }, timeoutMs);

    function failPending(error) {
      for (const { reject: rejectCommand, timer } of pending.values()) {
        clearTimeout(timer);
        rejectCommand(error);
      }
      pending.clear();
    }

    socket.addEventListener('open', () => {
      clearTimeout(connectTimer);
      settled = true;
      resolve({
        send(method, params = {}, commandTimeoutMs = timeoutMs) {
          if (socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP WebSocket is not open'));
          return new Promise((resolveCommand, rejectCommand) => {
            const id = ++nextId;
            const timer = setTimeout(() => {
              pending.delete(id);
              rejectCommand(new Error(`CDP command timed out: ${method}`));
            }, commandTimeoutMs);
            pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timer });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          failPending(new Error('CDP connection closed'));
          try { socket.close(); } catch {}
        },
      });
    }, { once: true });

    socket.addEventListener('message', event => {
      let data = event.data;
      if (typeof data !== 'string') data = Buffer.from(data).toString('utf8');
      let message;
      try { message = JSON.parse(data); } catch { return; }
      if (!message.id || !pending.has(message.id)) return;
      const command = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(command.timer);
      if (message.error) command.reject(new Error(`${message.error.message || 'CDP error'} ${JSON.stringify(message.error)}`));
      else command.resolve(message.result);
    });

    socket.addEventListener('error', event => {
      const error = event.error || new Error('CDP WebSocket failed');
      if (!settled) { clearTimeout(connectTimer); reject(error); }
      failPending(error);
    });
    socket.addEventListener('close', () => failPending(new Error('CDP WebSocket closed')));
  });
}

async function evaluate(client, expression, timeoutMs = 60000) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: false,
  }, timeoutMs);
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails.exception && response.exceptionDetails.exception.description;
    throw new Error(detail || response.exceptionDetails.text || 'Browser-context evaluation failed');
  }
  return response.result && response.result.value;
}

function requestExpression(config) {
  return `(async () => {
    const config = ${JSON.stringify(config)};
    try {
      const requested = new URL(config.url);
      if (requested.origin !== config.origin) return { transportError: 'cross-origin request blocked before fetch' };
      const response = await fetch(requested.href, {
        method: 'GET',
        credentials: 'include',
        redirect: 'follow',
        cache: 'no-store',
        headers: { Accept: config.accept }
      });
      if (new URL(response.url).origin !== config.origin) {
        return { transportError: 'cross-origin redirect blocked', status: response.status, url: response.url };
      }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > config.maxBytes) {
        return { status: response.status, url: response.url, contentType: response.headers.get('content-type') || '', tooLarge: true, declaredBytes: declared, maxBytes: config.maxBytes };
      }
      const text = await response.text();
      const bytes = new TextEncoder().encode(text).byteLength;
      if (bytes > config.maxBytes) {
        return { status: response.status, url: response.url, contentType: response.headers.get('content-type') || '', tooLarge: true, receivedBytes: bytes, maxBytes: config.maxBytes };
      }
      return { status: response.status, statusText: response.statusText, url: response.url, contentType: response.headers.get('content-type') || '', text, receivedBytes: bytes };
    } catch (error) {
      return { transportError: String(error && (error.stack || error.message) || error) };
    }
  })()`;
}

function binaryStartExpression(config) {
  return `(async () => {
    const config = ${JSON.stringify(config)};
    globalThis.__agentSkillsBinaryTransfers ||= Object.create(null);
    try {
      const requested = new URL(config.url);
      if (requested.origin !== config.origin) return { transportError: 'cross-origin request blocked before fetch' };
      const response = await fetch(requested.href, {
        method: 'GET', credentials: 'include', redirect: 'follow', cache: 'no-store', headers: { Accept: config.accept }
      });
      if (new URL(response.url).origin !== config.origin) {
        return { transportError: 'cross-origin redirect blocked', status: response.status, url: response.url };
      }
      const contentType = response.headers.get('content-type') || '';
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > config.maxBytes) {
        try { await response.body?.cancel(); } catch {}
        return { status: response.status, url: response.url, contentType, tooLarge: true, declaredBytes: declared, maxBytes: config.maxBytes };
      }
      const chunks = [];
      let total = 0;
      if (response.body && response.body.getReader) {
        const reader = response.body.getReader();
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          total += part.value.byteLength;
          if (total > config.maxBytes) {
            try { await reader.cancel(); } catch {}
            return { status: response.status, url: response.url, contentType, tooLarge: true, receivedBytes: total, maxBytes: config.maxBytes };
          }
          chunks.push(part.value);
        }
      } else {
        const data = new Uint8Array(await response.arrayBuffer());
        total = data.byteLength;
        if (total > config.maxBytes) return { status: response.status, url: response.url, contentType, tooLarge: true, receivedBytes: total, maxBytes: config.maxBytes };
        chunks.push(data);
      }
      const data = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
      globalThis.__agentSkillsBinaryTransfers[config.transferId] = data;
      return { status: response.status, statusText: response.statusText, url: response.url, contentType, transferId: config.transferId, receivedBytes: total };
    } catch (error) {
      return { transportError: String(error && (error.stack || error.message) || error) };
    }
  })()`;
}

class BrowserContextTransport {
  constructor({ client, origin, textLimitBytes = DEFAULT_TEXT_LIMIT, binaryChunkBytes = DEFAULT_BINARY_CHUNK }) {
    if (!client || typeof client.send !== 'function') throw new Error('BrowserContextTransport requires a CDP client');
    this.client = client;
    this.origin = validateOrigin(origin);
    this.textLimitBytes = textLimitBytes;
    this.binaryChunkBytes = binaryChunkBytes;
  }

  async text(rawUrl, { accept = '*/*', maxBytes = this.textLimitBytes, timeoutMs = 60000 } = {}) {
    const url = validateSameOriginUrl(rawUrl, this.origin);
    const result = await evaluate(this.client, requestExpression({ url, origin: this.origin, accept, maxBytes }), timeoutMs);
    if (!result) throw new Error(`Empty browser response for ${url}`);
    if (result.transportError) throw new Error(`Browser request failed for ${url}: ${result.transportError}`);
    if (result.url) validateSameOriginUrl(result.url, this.origin);
    if (!Number.isInteger(result.status)) throw new Error(`Invalid browser response status for ${url}`);
    if (result.tooLarge) throw new Error(`Browser response exceeds ${maxBytes} bytes for ${url}`);
    return result;
  }

  async json(rawUrl, options = {}) {
    const result = await this.text(rawUrl, { ...options, accept: options.accept || 'application/json' });
    let json = null;
    try { json = JSON.parse(result.text); } catch {}
    return { ...result, json };
  }

  async buffer(rawUrl, { accept = '*/*', maxBytes, timeoutMs = 120000 } = {}) {
    if (!Number.isFinite(maxBytes) || maxBytes < 0) throw new Error('Browser binary request requires a finite non-negative maxBytes');
    const url = validateSameOriginUrl(rawUrl, this.origin);
    const transferId = crypto.randomBytes(16).toString('hex');
    const result = await evaluate(this.client, binaryStartExpression({ url, origin: this.origin, accept, maxBytes, transferId }), timeoutMs);
    if (!result) throw new Error(`Empty browser response for ${url}`);
    if (result.transportError) throw new Error(`Browser request failed for ${url}: ${result.transportError}`);
    if (result.url) validateSameOriginUrl(result.url, this.origin);
    if (!Number.isInteger(result.status)) throw new Error(`Invalid browser response status for ${url}`);
    if (result.tooLarge) return { ...result, buffer: null };
    if (result.transferId !== transferId || !Number.isFinite(result.receivedBytes)) throw new Error(`Invalid browser binary transfer metadata for ${url}`);

    const chunks = [];
    try {
      for (let offset = 0; offset < result.receivedBytes; offset += this.binaryChunkBytes) {
        const length = Math.min(this.binaryChunkBytes, result.receivedBytes - offset);
        const expression = `(() => {
          const data = globalThis.__agentSkillsBinaryTransfers && globalThis.__agentSkillsBinaryTransfers[${JSON.stringify(transferId)}];
          if (!data) throw new Error('binary transfer missing');
          const chunk = data.subarray(${offset}, ${offset + length});
          let binary = '';
          for (let i = 0; i < chunk.length; i += 0x8000) binary += String.fromCharCode(...chunk.subarray(i, i + 0x8000));
          return btoa(binary);
        })()`;
        const base64 = await evaluate(this.client, expression, timeoutMs);
        chunks.push(Buffer.from(base64, 'base64'));
      }
    } finally {
      await evaluate(this.client, `(() => { if (globalThis.__agentSkillsBinaryTransfers) delete globalThis.__agentSkillsBinaryTransfers[${JSON.stringify(transferId)}]; return true; })()`, 10000).catch(() => {});
    }
    const buffer = Buffer.concat(chunks);
    if (buffer.length !== result.receivedBytes || buffer.length > maxBytes) throw new Error(`Invalid browser binary transfer size for ${url}`);
    return { ...result, buffer };
  }

  close() { this.client.close(); }
}

function createBrowserContextSession(options) {
  const origin = validateOrigin(options.origin);
  const port = Number(options.port || 9223);
  const waitSec = Number(options.waitSec || 900);
  const browserBackend = selectBrowserBackend(options.browserBackend || 'auto');
  const browser = options.browser || 'chrome';
  const nativeProfileDir = options.profileDir || path.join(os.homedir(), '.local/share/atlassian-browser-chrome');
  const powershellScript = options.powershellScript || path.join(__dirname, 'launch-windows-browser.ps1');

  async function endpoint(pathname, init = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { ...init, signal: controller.signal });
      if (!response.ok) throw new Error(`DevTools HTTP ${response.status} for ${pathname}`);
      return response.json();
    } finally { clearTimeout(timer); }
  }

  async function devtoolsReady() {
    try { await endpoint('/json/version'); return true; } catch { return false; }
  }

  async function waitDevtools() {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await devtoolsReady()) return;
      await sleep(250);
    }
    throw new Error('Browser DevTools endpoint did not start on loopback');
  }

  function runWindowsLauncher(mode, openUrl) {
    const powershell = resolveExecutable('powershell.exe');
    if (!powershell) throw new Error('powershell.exe was not found; Windows/WSL browser backend requires Windows PowerShell interoperability');
    if (!fs.existsSync(powershellScript)) throw new Error(`Windows browser launcher is missing: ${powershellScript}`);
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', toWindowsPath(powershellScript), '-Mode', mode, '-Browser', browser, '-Port', String(port)];
    if (options.profileDir) args.push('-ProfileDir', options.profileDir);
    if (openUrl) args.push('-Url', openUrl);
    const result = spawnSync(powershell, args, { encoding: 'utf8', timeout: 30000, windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Windows browser launcher failed: ${(result.stderr || result.stdout || '').trim()}`);
    const line = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1);
    try { return JSON.parse(line); } catch { throw new Error(`Windows browser launcher returned invalid output: ${line || '(empty)'}`); }
  }

  function launchNative(openUrl) {
    const executable = findNativeBrowser();
    fs.mkdirSync(nativeProfileDir, { recursive: true });
    const args = [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-allow-origins=http://127.0.0.1',
      `--user-data-dir=${nativeProfileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      openUrl,
    ];
    console.log(`Launching native browser: ${executable}`);
    const child = spawn(executable, args, { detached: true, stdio: 'ignore' });
    child.on('error', error => console.error(`Failed to launch ${executable}: ${error.message}`));
    child.unref();
  }

  async function targets() {
    const list = await endpoint('/json/list');
    return list.filter(target => target.type === 'page' && target.webSocketDebuggerUrl);
  }

  async function findOriginTarget(pathPrefix = '') {
    const list = await targets();
    return list.find(target => {
      try {
        const url = new URL(target.url);
        return url.origin === origin && (!pathPrefix || url.pathname.startsWith(pathPrefix));
      } catch { return false; }
    }) || list.find(target => {
      try { return new URL(target.url).origin === origin; } catch { return false; }
    });
  }

  async function openTab(url) {
    const safeUrl = validateSameOriginUrl(url, origin);
    const targetUrl = `http://127.0.0.1:${port}/json/new?${encodeURIComponent(safeUrl)}`;
    for (const init of [{ method: 'PUT' }, {}]) {
      try {
        const response = await fetch(targetUrl, init);
        if (response.ok) { await sleep(500); return true; }
      } catch {}
    }
    return false;
  }

  async function ensureBrowser(openUrl) {
    const safeOpenUrl = validateSameOriginUrl(openUrl || `${origin}/`, origin);
    if (browserBackend === 'windows-wsl') {
      const status = runWindowsLauncher('Ensure', safeOpenUrl);
      console.log(`${status.status === 'reused' ? 'Reusing' : 'Launching'} Windows ${browser} browser on DevTools port ${port}`);
      await waitDevtools();
      if (!(await findOriginTarget())) await openTab(safeOpenUrl);
    } else if (!(await devtoolsReady())) {
      launchNative(safeOpenUrl);
      await waitDevtools();
    } else {
      console.log(`Reusing native browser DevTools on port ${port}`);
      if (!(await findOriginTarget())) await openTab(safeOpenUrl);
    }
  }

  async function waitForAuthenticatedTransport(openUrl, verifySession, { pathPrefix = '' } = {}) {
    if (typeof verifySession !== 'function') throw new Error('waitForAuthenticatedTransport requires a verifier callback');
    await ensureBrowser(openUrl);
    console.log(`If prompted in the dedicated browser, complete SSO for: ${openUrl}`);
    const deadline = Date.now() + waitSec * 1000;
    let lastMessage = 'waiting for a target tab at the configured origin';
    while (Date.now() < deadline) {
      let transport;
      try {
        const target = await findOriginTarget(pathPrefix);
        if (!target) {
          lastMessage = 'waiting for SSO to return to the configured origin';
        } else {
          const client = await connectCdp(target.webSocketDebuggerUrl);
          transport = new BrowserContextTransport({ client, origin, textLimitBytes: options.textLimitBytes });
          const verification = await verifySession(transport);
          if (verification && verification.ok) {
            if (process.stdout.isTTY) process.stdout.write('\n');
            console.log(`Authenticated browser session verified${verification.url ? ` via ${verification.url}` : ''}`);
            return transport;
          }
          lastMessage = verification && verification.message || 'session not yet verified';
        }
      } catch (error) {
        lastMessage = error.message;
      }
      if (transport) transport.close();
      if (process.stdout.isTTY) process.stdout.write(`\r${new Date().toLocaleTimeString()} ${lastMessage.padEnd(120).slice(0, 120)}`);
      await sleep(3000);
    }
    if (process.stdout.isTTY) process.stdout.write('\n');
    throw new Error(`Could not verify authenticated browser session. Last result: ${lastMessage}`);
  }

  function closeBrowser() {
    if (browserBackend !== 'windows-wsl') throw new Error('Automatic close is currently supported only for the Windows/WSL backend');
    return runWindowsLauncher('Stop');
  }

  return {
    browserBackend,
    origin,
    devtoolsReady,
    waitDevtools,
    ensureBrowser,
    findOriginTarget,
    openTab,
    waitForAuthenticatedTransport,
    closeBrowser,
  };
}

module.exports = {
  BrowserContextTransport,
  DEFAULT_BINARY_CHUNK,
  DEFAULT_TEXT_LIMIT,
  connectCdp,
  createBrowserContextSession,
  evaluate,
  findNativeBrowser,
  isWsl,
  resolveExecutable,
  selectBrowserBackend,
  toWindowsPath,
  validateOrigin,
  validateSameOriginUrl,
};
