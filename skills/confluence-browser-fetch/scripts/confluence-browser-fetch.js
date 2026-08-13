#!/usr/bin/env node
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
let createBrowserContextSession;
try {
  ({ createBrowserContextSession } = require('./browser-context'));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.error('scripts/browser-context.js is missing — this skill install is incomplete.');
  console.error('Reinstall: npx skills add aholbreich/agent-skills');
  process.exit(1);
}
const { parseSize, formatBytes, slugify, safeName, extractPageId, sameVersion } = require('./lib');
const { inferConfluenceDeployment, relatedPagesUrl } = require('./confluence-deployment');

const HARD_BINARY_LIMIT = parseSize(process.env.CONFLUENCE_BROWSER_MAX_BINARY_SIZE || '100mb');

function usage() {
  console.log(`Usage: confluence-browser-fetch <URL|PAGE-ID> [...] [options]

Fetch Confluence Cloud or Server/Data Center pages through an authenticated,
dedicated browser session. Browser-context requests retain SSO without reading
or exporting browser cookies.

Options:
  --site URL               Confluence origin/application URL; inferred from an absolute page URL
  --context-path PATH      Confluence context path: auto (default), /wiki, /, or a custom path
  --raw-dir DIR            Output raw directory (default: CONFLUENCE_RAW_DIR or ./raw)
  --space KEY              Resolve --title inside this space, or constrain CQL
  --title TITLE            Resolve and fetch page by title; repeatable with --space
  --cql CQL                Search Confluence with CQL and fetch matching pages
  --children               Fetch only immediate child pages of each requested seed
  --descendants            Fetch all descendant pages of each requested seed
  --max-search-results N   Max pages to add per CQL search (default: 200)
  --max-attachment-size S  Skip attachment downloads larger than S (default: 5mb)
  --force                  Re-fetch even when local page version is current
  --no-skip-unchanged      Disable version/timestamp skip check
  --no-attachments         Do not download attachments
  --no-browser-html        Do not save rendered browser HTML response
  --retries N              Browser request retry count for transient failures (default: 3)
  --request-timeout SEC    Per-request timeout (default: 60)
  --wait SEC               Wait time for SSO/session (default: 900)
  --port PORT              DevTools port (default: 9223)
  --profile-dir PATH       Dedicated profile path (Windows path for windows-wsl backend)
  --browser-backend NAME   auto (default), native, or windows-wsl
  --browser NAME           chrome (default) or edge for windows-wsl
  --help                   Show this help

Examples:
  confluence-browser-fetch 'https://example.atlassian.net/wiki/spaces/ABC/pages/123456/Page+Title' --raw-dir ./raw
  confluence-browser-fetch 'https://confluence.example.com/pages/viewpage.action?pageId=123456' --raw-dir ./raw
  confluence-browser-fetch 123456 --site https://confluence.example.com --context-path / --raw-dir ./raw
  confluence-browser-fetch 123456 --site https://intranet.example.com --context-path /confluence --descendants --raw-dir ./raw
`);
}

const opts = {
  site: process.env.CONFLUENCE_SITE || '',
  contextPath: process.env.CONFLUENCE_CONTEXT_PATH || 'auto',
  rawDir: process.env.CONFLUENCE_RAW_DIR || path.resolve(process.cwd(), 'raw'),
  port: Number(process.env.CONFLUENCE_CHROME_DEBUG_PORT || process.env.ATLASSIAN_CHROME_DEBUG_PORT || 9223),
  waitSec: Number(process.env.CONFLUENCE_FETCH_WAIT_SEC || 900),
  profileDir: process.env.CONFLUENCE_CHROME_PROFILE || process.env.ATLASSIAN_CHROME_PROFILE || '',
  browserBackend: process.env.CONFLUENCE_BROWSER_BACKEND || 'auto',
  browser: process.env.CONFLUENCE_BROWSER || 'chrome',
  maxSearchResults: Number(process.env.CONFLUENCE_MAX_SEARCH_RESULTS || 200),
  retries: Number(process.env.CONFLUENCE_RETRIES || 3),
  requestTimeoutSec: Number(process.env.CONFLUENCE_REQUEST_TIMEOUT_SEC || 60),
  maxAttachmentBytes: parseSize(process.env.CONFLUENCE_MAX_ATTACHMENT_SIZE || process.env.CONFLUENCE_MAX_ATTACHMENT_BYTES || '5mb'),
  skipUnchanged: process.env.CONFLUENCE_SKIP_UNCHANGED !== '0',
  force: false,
  attachments: true,
  browserHtml: true,
  children: false,
  descendants: false,
  cqls: [],
  titles: [],
  space: null,
};
const inputs = [];

for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  const value = () => {
    if (index + 1 >= process.argv.length) throw new Error(`${argument} requires a value`);
    return process.argv[++index];
  };
  try {
    if (argument === '-h' || argument === '--help') { usage(); process.exit(0); }
    else if (argument === '--site') opts.site = value();
    else if (argument === '--context-path') opts.contextPath = value();
    else if (argument === '--raw-dir') opts.rawDir = value();
    else if (argument === '--space') opts.space = value();
    else if (argument === '--title') opts.titles.push(value());
    else if (argument === '--cql') opts.cqls.push(value());
    else if (argument === '--children') opts.children = true;
    else if (argument === '--descendants') opts.descendants = true;
    else if (argument === '--max-search-results') opts.maxSearchResults = Number(value());
    else if (argument === '--max-attachment-size') opts.maxAttachmentBytes = parseSize(value());
    else if (argument === '--force') opts.force = true;
    else if (argument === '--no-skip-unchanged') opts.skipUnchanged = false;
    else if (argument === '--retries') opts.retries = Number(value());
    else if (argument === '--request-timeout') opts.requestTimeoutSec = Number(value());
    else if (argument === '--no-attachments') opts.attachments = false;
    else if (argument === '--no-browser-html') opts.browserHtml = false;
    else if (argument === '--wait') opts.waitSec = Number(value());
    else if (argument === '--port') opts.port = Number(value());
    else if (argument === '--profile-dir') opts.profileDir = value();
    else if (argument === '--browser-backend') opts.browserBackend = value();
    else if (argument === '--browser') opts.browser = value();
    else if (!argument.startsWith('-')) inputs.push(argument);
    else throw new Error(`Unknown argument: ${argument}`);
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(2);
  }
}

if (!inputs.length && !opts.titles.length && !opts.cqls.length) { usage(); process.exit(2); }
if (!Number.isInteger(opts.port) || opts.port < 1024 || opts.port > 65535) { console.error('error: --port must be from 1024 to 65535'); process.exit(2); }
if (!Number.isFinite(opts.waitSec) || opts.waitSec < 1) { console.error('error: --wait must be a positive number'); process.exit(2); }
if (!Number.isInteger(opts.maxSearchResults) || opts.maxSearchResults < 1) { console.error('error: --max-search-results must be a positive integer'); process.exit(2); }
if (!Number.isInteger(opts.retries) || opts.retries < 0 || opts.retries > 10) { console.error('error: --retries must be from 0 to 10'); process.exit(2); }
if (!Number.isFinite(opts.requestTimeoutSec) || opts.requestTimeoutSec < 1) { console.error('error: --request-timeout must be positive'); process.exit(2); }
if (opts.children && opts.descendants) { console.error('error: use either --children or --descendants, not both'); process.exit(2); }
if (!['auto', 'native', 'windows-wsl'].includes(opts.browserBackend)) { console.error('error: --browser-backend must be auto, native, or windows-wsl'); process.exit(2); }
if (!['chrome', 'edge'].includes(opts.browser)) { console.error('error: --browser must be chrome or edge'); process.exit(2); }

let deployment;
try {
  deployment = inferConfluenceDeployment({ site: opts.site, inputs, contextPath: opts.contextPath });
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(2);
}
opts.rawDir = path.resolve(opts.rawDir);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const requestTimeoutMs = opts.requestTimeoutSec * 1000;

let browserSession;
let transport;

function getBrowserSession() {
  if (browserSession) return browserSession;
  browserSession = createBrowserContextSession({
    origin: deployment.origin,
    port: opts.port,
    waitSec: opts.waitSec,
    profileDir: opts.profileDir,
    browserBackend: opts.browserBackend,
    browser: opts.browser,
  });
  return browserSession;
}

function shouldRetry(status) {
  return status === 408 || status === 429 || status >= 500;
}

async function withRetry(operation, label) {
  let lastError;
  const attempts = opts.retries + 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await operation();
      if (!shouldRetry(result.status) || attempt === attempts) return result;
      lastError = new Error(`${label} HTTP ${result.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    await sleep(Math.min(30000, 1000 * 2 ** (attempt - 1)));
  }
  throw lastError;
}

function fetchText(url, accept = '*/*') {
  return withRetry(() => transport.text(url, { accept, timeoutMs: requestTimeoutMs }), url);
}

function fetchJson(url) {
  return withRetry(() => transport.json(url, { timeoutMs: requestTimeoutMs }), url);
}

async function verifyConfluenceSession(candidateTransport) {
  const probes = [
    deployment.api('user/current'),
    `${deployment.api('space')}?limit=1`,
  ];
  for (const url of probes) {
    try {
      const result = await candidateTransport.json(url, { timeoutMs: requestTimeoutMs });
      if (result.status === 200 && result.json) return { ok: true, url };
      if (result.status === 401 || result.status === 403) return { ok: false, message: `not authenticated yet (${result.status} from ${url})` };
      if (result.status === 404) continue;
      return { ok: false, message: `session probe HTTP ${result.status} from ${url}` };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }
  return { ok: false, message: `could not verify Confluence session at ${deployment.apiBase}; check --context-path` };
}

function cqlQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

async function searchCql(cql) {
  const found = [];
  let start = 0;
  const pageSize = Math.min(100, opts.maxSearchResults);
  while (found.length < opts.maxSearchResults) {
    const limit = Math.min(pageSize, opts.maxSearchResults - found.length);
    const url = `${deployment.api('content/search')}?cql=${encodeURIComponent(cql)}&limit=${limit}&start=${start}&expand=space,version`;
    const result = await fetchJson(url);
    if (result.status !== 200 || !result.json || !Array.isArray(result.json.results)) {
      throw new Error(`CQL failed HTTP ${result.status}: ${(result.text || '').slice(0, 300)}`);
    }
    for (const item of result.json.results) if (item.id) found.push(String(item.id));
    if (!result.json._links || !result.json._links.next || !result.json.results.length) break;
    start += result.json.results.length;
  }
  return [...new Set(found)];
}

async function resolveInputToPageId(input) {
  const direct = extractPageId(input);
  if (direct) return direct;
  if (/^https?:\/\//.test(String(input))) {
    const html = await fetchText(input, 'text/html');
    const match = html.text.match(/(?:ajs-page-id|content-id|contentId|pageId)["'=:\s]+(\d+)/i);
    if (match) return match[1];
    throw new Error(`Could not extract page id from URL: ${input}`);
  }
  throw new Error(`Input is not a page id or supported Confluence URL: ${input}`);
}

async function fetchPageJson(pageId) {
  const expand = 'body.storage,body.view,version,space,ancestors,metadata.labels,children.attachment,history';
  const url = `${deployment.api(`content/${encodeURIComponent(pageId)}`)}?expand=${encodeURIComponent(expand)}`;
  const result = await fetchJson(url);
  if (result.status !== 200 || !result.json || !result.json.id) {
    throw new Error(`Page ${pageId} failed HTTP ${result.status}: ${(result.text || '').slice(0, 300)}`);
  }
  return { url, page: result.json };
}

function pageWebUrl(page) {
  const webui = page && page._links && page._links.webui;
  return webui ? deployment.web(webui) : deployment.web(`pages/viewpage.action?pageId=${page.id}`);
}

function outputDirForPage(page) {
  const space = page.space && (page.space.key || page.space.name) || 'unknown-space';
  return path.join(opts.rawDir, 'confluence', slugify(space), `${page.id}-${slugify(page.title)}`);
}

async function downloadAttachments(page, outDir) {
  const manifest = [];
  const attachDir = path.join(outDir, 'attachments');
  await fsp.mkdir(attachDir, { recursive: true });

  let url = `${deployment.api(`content/${encodeURIComponent(page.id)}/child/attachment`)}?limit=200&expand=version,metadata`;
  while (url) {
    const result = await fetchJson(url);
    if (result.status !== 200 || !result.json) {
      manifest.push({ error: `attachment listing HTTP ${result.status}`, url });
      break;
    }
    for (const attachment of result.json.results || []) {
      const download = attachment._links && attachment._links.download;
      if (!download) continue;
      const fullUrl = deployment.web(download);
      const filename = safeName(attachment.title || `${attachment.id}.bin`);
      const fileSize = Number(attachment.extensions && attachment.extensions.fileSize);
      const baseEntry = {
        id: attachment.id,
        filename,
        url: fullUrl,
        mediaType: attachment.metadata && attachment.metadata.mediaType,
        fileSize: Number.isFinite(fileSize) ? fileSize : attachment.extensions && attachment.extensions.fileSize,
        version: attachment.version,
      };
      if (Number.isFinite(fileSize) && fileSize > opts.maxAttachmentBytes) {
        console.log(`Attachment ${filename} ... skipped (${formatBytes(fileSize)} > ${formatBytes(opts.maxAttachmentBytes)})`);
        manifest.push({ ...baseEntry, skipped: true, reason: 'larger-than-max-attachment-size', maxAttachmentBytes: opts.maxAttachmentBytes });
        continue;
      }

      const transferLimit = Number.isFinite(opts.maxAttachmentBytes) ? Math.min(opts.maxAttachmentBytes, HARD_BINARY_LIMIT) : HARD_BINARY_LIMIT;
      process.stdout.write(`Attachment ${filename} ... `);
      let binary;
      try {
        binary = await withRetry(
          () => transport.buffer(fullUrl, { maxBytes: transferLimit, timeoutMs: Math.max(requestTimeoutMs, 120000) }),
          `attachment ${filename}`
        );
      } catch (error) {
        console.log(`failed: ${error.message}`);
        manifest.push({ ...baseEntry, error: error.message });
        continue;
      }
      if (binary.tooLarge) {
        console.log(`skipped (exceeds ${formatBytes(transferLimit)} browser transfer limit)`);
        manifest.push({ ...baseEntry, skipped: true, reason: 'larger-than-browser-transfer-limit', maxTransferBytes: transferLimit });
        continue;
      }
      if (binary.status < 200 || binary.status >= 300 || !binary.buffer) {
        console.log(`HTTP ${binary.status}`);
        manifest.push({ ...baseEntry, status: binary.status });
        continue;
      }
      const target = path.join(attachDir, filename);
      await fsp.writeFile(target, binary.buffer);
      console.log(`${binary.buffer.length} bytes`);
      manifest.push({ ...baseEntry, path: path.relative(outDir, target), downloadedBytes: binary.buffer.length, status: binary.status });
    }
    const next = result.json._links && result.json._links.next;
    url = next ? deployment.web(next) : null;
  }

  await fsp.writeFile(path.join(outDir, 'attachments.json'), JSON.stringify(manifest, null, 2));
  return manifest.length;
}

async function fetchRelatedPageIds(pageId, relation) {
  const direct = relation === 'children';
  const ids = [];
  let url = relatedPagesUrl(deployment, pageId, relation);
  while (url) {
    const result = await fetchJson(url);
    if (result.status !== 200 || !result.json) {
      const label = direct ? 'Children' : 'Descendants';
      throw new Error(`${label} failed HTTP ${result.status}: ${(result.text || '').slice(0, 300)}`);
    }
    for (const page of result.json.results || []) if (page.id) ids.push(String(page.id));
    const next = result.json._links && result.json._links.next;
    url = next ? deployment.web(next) : null;
  }
  return [...new Set(ids)];
}

async function readExistingMetadata(outDir) {
  try { return JSON.parse(await fsp.readFile(path.join(outDir, 'metadata.json'), 'utf8')); }
  catch { return null; }
}

async function fetchOnePage(pageId) {
  const { url: restUrl, page } = await fetchPageJson(pageId);
  const outDir = outputDirForPage(page);
  await fsp.mkdir(outDir, { recursive: true });

  const existing = await readExistingMetadata(outDir);
  if (opts.skipUnchanged && !opts.force && sameVersion(existing, page)) {
    console.log(`Skipped unchanged ${page.title} (${page.id}) version ${page.version && page.version.number} -> ${outDir}`);
    return { page, outDir, skipped: true };
  }

  await fsp.writeFile(path.join(outDir, 'page.json'), JSON.stringify(page, null, 2));
  await fsp.writeFile(path.join(outDir, 'page.storage.html'), page.body && page.body.storage && page.body.storage.value || '');
  await fsp.writeFile(path.join(outDir, 'page.view.html'), page.body && page.body.view && page.body.view.value || '');

  const webUrl = pageWebUrl(page);
  let browserStatus = 0;
  if (opts.browserHtml) {
    const html = await fetchText(webUrl, 'text/html');
    browserStatus = html.status;
    await fsp.writeFile(path.join(outDir, 'page.browser.html'), html.text);
  }

  let attachmentCount = 0;
  if (opts.attachments) attachmentCount = await downloadAttachments(page, outDir);

  const metadata = {
    fetchedAt: new Date().toISOString(),
    id: page.id,
    title: page.title,
    type: page.type,
    status: page.status,
    space: page.space && { key: page.space.key, name: page.space.name },
    version: page.version,
    confluence: { origin: deployment.origin, contextPath: deployment.contextPath, apiBase: deployment.apiBase },
    authenticationTransport: 'browser-context-get',
    webUrl,
    restUrl,
    browserStatus,
    attachmentCount,
  };
  await fsp.writeFile(path.join(outDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  console.log(`Saved ${page.title} (${page.id}) -> ${outDir}`);
  return { page, outDir, skipped: false };
}

async function main() {
  await fsp.mkdir(opts.rawDir, { recursive: true });
  const openUrl = inputs.find(input => /^https?:\/\//.test(input)) || deployment.appBase || deployment.origin;
  transport = await getBrowserSession().waitForAuthenticatedTransport(openUrl, verifyConfluenceSession, { pathPrefix: deployment.contextPath });

  const queue = [];
  const failed = [];
  const searches = [];

  for (const input of inputs) {
    try { queue.push({ id: await resolveInputToPageId(input), from: input, expandOneLevel: opts.children, expandDescendants: opts.descendants }); }
    catch (error) { failed.push({ input, error: error.message }); console.error(`FAILED resolving ${input}: ${error.message}`); }
  }

  for (const title of opts.titles) {
    opts.cqls.push(`${opts.space ? `space = ${cqlQuote(opts.space)} and ` : ''}type = page and title = ${cqlQuote(title)}`);
  }

  for (const cql of opts.cqls) {
    console.log(`Searching CQL: ${cql}`);
    try {
      const ids = await searchCql(cql);
      searches.push({ cql, ids });
      console.log(`CQL matched ${ids.length} page(s): ${ids.join(' ') || '(none)'}`);
      for (const id of ids) queue.push({ id, from: `CQL: ${cql}`, expandOneLevel: opts.children, expandDescendants: opts.descendants });
    } catch (error) {
      failed.push({ input: `CQL: ${cql}`, error: error.message });
      console.error(`CQL FAILED: ${error.message}`);
    }
  }

  const seen = new Set();
  const fetched = [];
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    if (!item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    console.log(`\n===== Fetching Confluence page ${item.id}${item.from ? ` (${item.from})` : ''} =====`);
    try {
      const { page, outDir, skipped } = await fetchOnePage(item.id);
      fetched.push({ id: page.id, title: page.title, outDir, skipped });
      if (item.expandDescendants) {
        const descendants = await fetchRelatedPageIds(page.id, 'descendants');
        console.log(`Descendants: ${descendants.join(' ') || '(none)'}`);
        for (const id of descendants) if (!seen.has(id) && !queue.some(entry => entry.id === id)) queue.push({ id, from: `descendant of ${page.id}`, expandOneLevel: false });
      } else if (item.expandOneLevel) {
        const children = await fetchRelatedPageIds(page.id, 'children');
        console.log(`Children: ${children.join(' ') || '(none)'}`);
        for (const id of children) if (!seen.has(id) && !queue.some(entry => entry.id === id)) queue.push({ id, from: `child of ${page.id}`, expandOneLevel: false });
      }
    } catch (error) {
      failed.push({ input: item.id, error: error.message });
      console.error(`FAILED page ${item.id}: ${error.message}`);
    }
  }

  const runMetadata = {
    fetchedAt: new Date().toISOString(),
    site: deployment.site,
    contextPath: deployment.contextPath,
    browserBackend: getBrowserSession().browserBackend,
    authenticationTransport: 'browser-context-get',
    rawDir: opts.rawDir,
    inputs,
    searches,
    fetched,
    failed,
  };
  await fsp.writeFile(path.join(opts.rawDir, 'confluence-browser-fetch-run.json'), JSON.stringify(runMetadata, null, 2));
  if (failed.length) {
    console.error(`\nCompleted with ${failed.length} failure(s). See ${path.join(opts.rawDir, 'confluence-browser-fetch-run.json')}`);
    process.exitCode = 1;
  } else {
    console.log(`\nCompleted successfully. See ${path.join(opts.rawDir, 'confluence-browser-fetch-run.json')}`);
  }
}

main().catch(error => {
  console.error(`\nERROR: ${error.stack || error.message}`);
  process.exitCode = 1;
}).finally(() => {
  if (transport) transport.close();
});
