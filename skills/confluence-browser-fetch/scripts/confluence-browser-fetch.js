#!/usr/bin/env node
'use strict';

const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
let createBrowserSession;
try {
  ({ createBrowserSession } = require('./atlassian-browser'));
} catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND') throw e;
  console.error('scripts/atlassian-browser.js is missing — this skill install is incomplete.');
  console.error('Reinstall: npx skills add aholbreich/agent-skills');
  process.exit(1);
}
const { parseSize, formatBytes, slugify, safeName, extractPageId, sameVersion } = require('./lib');

function usage() {
  console.log(`Usage: confluence-browser-fetch <URL|PAGE-ID> [...] [options]

Fetch Confluence Cloud pages through an authenticated Chrome browser session.
No Atlassian API token is required; useful for Microsoft/SSO environments.

Options:
  --site URL               Atlassian site base URL (or set CONFLUENCE_SITE), e.g. https://example.atlassian.net
  --raw-dir DIR            Output raw directory (default: CONFLUENCE_RAW_DIR or ./raw)
  --space KEY              Resolve --title inside this space, or constrain CQL
  --title TITLE            Resolve and fetch page by title; repeatable with --space
  --cql CQL                Search Confluence with CQL and fetch matching pages
  --descendants            Fetch descendant pages of each requested page
  --max-search-results N   Max pages to add per CQL search (default: 200)
  --max-attachment-size S  Skip attachment downloads larger than S (default: 5mb; use unlimited to disable)
  --force                  Re-fetch even when local page version is current
  --no-skip-unchanged      Disable version/timestamp skip check
  --no-attachments         Do not download attachments
  --no-browser-html        Do not save rendered browser HTML
  --retries N              HTTP retry count for transient failures (default: 3)
  --request-timeout SEC    Per-request timeout (default: 60)
  --wait SEC               Wait time for SSO/session (default: 900)
  --port PORT              Chrome DevTools port (default: CONFLUENCE_CHROME_DEBUG_PORT, ATLASSIAN_CHROME_DEBUG_PORT, or 9223)
  --profile-dir DIR        Chrome profile dir (default: CONFLUENCE_CHROME_PROFILE, ATLASSIAN_CHROME_PROFILE, or ~/.local/share/atlassian-browser-chrome)
  --help                   Show this help

Examples:
  confluence-browser-fetch 'https://example.atlassian.net/wiki/spaces/ABC/pages/123456/Page+Title' --site https://example.atlassian.net --raw-dir ./raw
  confluence-browser-fetch 123456 --site https://example.atlassian.net --raw-dir ./raw
  confluence-browser-fetch --space ABC --title 'Architecture Overview' --raw-dir ./raw
  confluence-browser-fetch --cql 'space = ABC and type = page and text ~ "billing"' --raw-dir ./raw
  confluence-browser-fetch 123456 --descendants --raw-dir ./raw
`);
}

const opts = {
  site: process.env.CONFLUENCE_SITE || '',
  rawDir: process.env.CONFLUENCE_RAW_DIR || path.resolve(process.cwd(), 'raw'),
  port: Number(process.env.CONFLUENCE_CHROME_DEBUG_PORT || process.env.ATLASSIAN_CHROME_DEBUG_PORT || 9223),
  waitSec: Number(process.env.CONFLUENCE_FETCH_WAIT_SEC || 900),
  profileDir: process.env.CONFLUENCE_CHROME_PROFILE || process.env.ATLASSIAN_CHROME_PROFILE || path.join(os.homedir(), '.local/share/atlassian-browser-chrome'),
  maxSearchResults: Number(process.env.CONFLUENCE_MAX_SEARCH_RESULTS || 200),
  retries: Number(process.env.CONFLUENCE_RETRIES || 3),
  requestTimeoutSec: Number(process.env.CONFLUENCE_REQUEST_TIMEOUT_SEC || 60),
  maxAttachmentBytes: parseSize(process.env.CONFLUENCE_MAX_ATTACHMENT_SIZE || process.env.CONFLUENCE_MAX_ATTACHMENT_BYTES || '5mb'),
  skipUnchanged: process.env.CONFLUENCE_SKIP_UNCHANGED !== '0',
  force: false,
  attachments: true,
  browserHtml: true,
  descendants: false,
  cqls: [],
  titles: [],
  space: null,
};
const inputs = [];

for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '-h' || a === '--help') { usage(); process.exit(0); }
  else if (a === '--site') opts.site = process.argv[++i];
  else if (a === '--raw-dir') opts.rawDir = process.argv[++i];
  else if (a === '--space') opts.space = process.argv[++i];
  else if (a === '--title') opts.titles.push(process.argv[++i]);
  else if (a === '--cql') opts.cqls.push(process.argv[++i]);
  else if (a === '--descendants') opts.descendants = true;
  else if (a === '--max-search-results') opts.maxSearchResults = Number(process.argv[++i]);
  else if (a === '--max-attachment-size') opts.maxAttachmentBytes = parseSize(process.argv[++i]);
  else if (a === '--force') opts.force = true;
  else if (a === '--no-skip-unchanged') opts.skipUnchanged = false;
  else if (a === '--retries') opts.retries = Number(process.argv[++i]);
  else if (a === '--request-timeout') opts.requestTimeoutSec = Number(process.argv[++i]);
  else if (a === '--no-attachments') opts.attachments = false;
  else if (a === '--no-browser-html') opts.browserHtml = false;
  else if (a === '--wait') opts.waitSec = Number(process.argv[++i]);
  else if (a === '--port') opts.port = Number(process.argv[++i]);
  else if (a === '--profile-dir') opts.profileDir = process.argv[++i];
  else if (!a.startsWith('-')) inputs.push(a);
  else { console.error(`Unknown argument: ${a}`); process.exit(2); }
}

if (!inputs.length && !opts.titles.length && !opts.cqls.length) { usage(); process.exit(2); }
opts.site = opts.site.replace(/\/$/, '');
if (/\/wiki$/i.test(opts.site)) {
  const stripped = opts.site.replace(/\/wiki$/i, '');
  console.error(`Note: stripping trailing /wiki from --site (${opts.site} -> ${stripped}). Pass the site root, e.g. https://example.atlassian.net.`);
  opts.site = stripped;
}
if (!opts.site) {
  console.error('Missing Atlassian site. Pass --site https://example.atlassian.net or set CONFLUENCE_SITE.');
  process.exit(2);
}
opts.rawDir = path.resolve(opts.rawDir);
const wikiBase = `${opts.site}/wiki`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let session = null;
function getSession() {
  if (session) return session;
  session = createBrowserSession({
    port: opts.port,
    profileDir: opts.profileDir,
    waitSec: opts.waitSec,
    serverHost: new URL(opts.site).host,
    cookieUrls: [`${opts.site}/`, wikiBase],
    userAgent: 'confluence-browser-fetch/1.0',
    verifySession: cookie => verifyConfluenceSession(cookie),
  });
  return session;
}

function shouldRetry(status) {
  return status === 408 || status === 429 || status >= 500;
}

async function fetchWithRetry(url, init = {}, label = url) {
  let lastErr;
  const attempts = Math.max(1, opts.retries + 1);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, opts.requestTimeoutSec) * 1000);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (!shouldRetry(res.status) || attempt === attempts) return res;
      lastErr = new Error(`${label} HTTP ${res.status}`);
      await sleep(Math.min(30000, 1000 * 2 ** (attempt - 1)));
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt === attempts) throw e;
      await sleep(Math.min(30000, 1000 * 2 ** (attempt - 1)));
    }
  }
  throw lastErr;
}

async function fetchText(url, cookie, accept) {
  const res = await fetchWithRetry(url, {
    redirect: 'follow',
    headers: {
      Cookie: cookie,
      Accept: accept || '*/*',
      'User-Agent': 'confluence-browser-fetch/1.0',
    },
  }, url);
  return { status: res.status, contentType: res.headers.get('content-type') || '', text: await res.text() };
}

async function fetchJson(url, cookie) {
  const result = await fetchText(url, cookie, 'application/json');
  let json = null;
  try { json = JSON.parse(result.text); } catch {}
  return { ...result, json };
}

async function verifyConfluenceSession(cookie) {
  if (!cookie) return { ok: false, message: 'no Atlassian cookies yet' };

  const probes = [
    `${wikiBase}/rest/api/user/current`,
    `${wikiBase}/rest/api/space?limit=1`,
  ];

  for (const url of probes) {
    const result = await fetchJson(url, cookie);
    if (result.status === 200 && result.json) return { ok: true, url };
    if (result.status === 401 || result.status === 403) {
      return { ok: false, message: `not authenticated yet (${result.status} from ${url})` };
    }
    if (result.status === 302 || result.status === 303) {
      return { ok: false, message: `still redirected to login (${result.status} from ${url})` };
    }
    if (result.status === 404) continue;
    return { ok: false, message: `session probe HTTP ${result.status} from ${url}` };
  }

  try {
    const sanity = await fetchJson(`${opts.site}/rest/api/3/myself`, cookie);
    if (sanity.status === 200 && sanity.json && (sanity.json.accountId || sanity.json.displayName)) {
      return { ok: false, message: `cookies are valid for ${opts.site} (Jira API responded) but Confluence at ${wikiBase} returned 404. Verify --site is the Atlassian site root (e.g. https://example.atlassian.net, without /wiki) and that Confluence is enabled on this tenant.` };
    }
  } catch {}

  return { ok: false, message: `could not verify Confluence session at ${wikiBase}. Verify --site is the Atlassian site root (e.g. https://example.atlassian.net, without /wiki).` };
}

function getCookieWithWait(openUrl) {
  return getSession().getCookieWithWait(openUrl || wikiBase, { tabPathPrefix: '/wiki' });
}

function cqlQuote(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`;
}

async function searchCql(cql, cookie) {
  const found = [];
  let start = 0;
  const pageSize = Math.min(100, Math.max(1, opts.maxSearchResults || 200));
  while (found.length < opts.maxSearchResults) {
    const limit = Math.min(pageSize, opts.maxSearchResults - found.length);
    const url = `${wikiBase}/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=${limit}&start=${start}&expand=space,version`;
    const result = await fetchJson(url, cookie);
    if (result.status !== 200 || !result.json || !Array.isArray(result.json.results)) {
      throw new Error(`CQL failed HTTP ${result.status}: ${(result.text || '').slice(0, 300)}`);
    }
    for (const item of result.json.results) if (item.id) found.push(String(item.id));
    if (!result.json._links || !result.json._links.next || !result.json.results.length) break;
    start += result.json.results.length;
  }
  return [...new Set(found)];
}

async function resolveInputToPageId(input, cookie) {
  const direct = extractPageId(input);
  if (direct) return direct;

  // Last resort for short/tiny links: fetch browser HTML and scan for content id markers.
  if (/^https?:\/\//.test(String(input))) {
    const html = await fetchText(input, cookie, 'text/html');
    const m = html.text.match(/(?:ajs-page-id|content-id|contentId|pageId)["'=:\s]+(\d+)/i);
    if (m) return m[1];
    throw new Error(`Could not extract page id from URL: ${input}`);
  }

  throw new Error(`Input is not a page id or supported Confluence URL: ${input}`);
}

async function fetchPageJson(pageId, cookie) {
  const expand = 'body.storage,body.view,version,space,ancestors,metadata.labels,children.attachment,history';
  const url = `${wikiBase}/rest/api/content/${encodeURIComponent(pageId)}?expand=${encodeURIComponent(expand)}`;
  const result = await fetchJson(url, cookie);
  if (result.status !== 200 || !result.json || !result.json.id) {
    throw new Error(`Page ${pageId} failed HTTP ${result.status}: ${(result.text || '').slice(0, 300)}`);
  }
  return { url, page: result.json };
}

function pageWebUrl(page) {
  const webui = page && page._links && page._links.webui;
  return webui ? `${wikiBase}${webui}` : `${wikiBase}/pages/viewpage.action?pageId=${page.id}`;
}

function outputDirForPage(page) {
  const space = page.space && (page.space.key || page.space.name) || 'unknown-space';
  return path.join(opts.rawDir, 'confluence', slugify(space), `${page.id}-${slugify(page.title)}`);
}

async function downloadAttachments(page, cookie, outDir) {
  const manifest = [];
  const attachDir = path.join(outDir, 'attachments');
  await fsp.mkdir(attachDir, { recursive: true });

  let url = `${wikiBase}/rest/api/content/${encodeURIComponent(page.id)}/child/attachment?limit=200&expand=version,metadata`;
  while (url) {
    const result = await fetchJson(url, cookie);
    if (result.status !== 200 || !result.json) {
      manifest.push({ error: `attachment listing HTTP ${result.status}`, url });
      break;
    }
    for (const att of result.json.results || []) {
      const download = att._links && att._links.download;
      if (!download) continue;
      const fullUrl = download.startsWith('http') ? download : `${download.startsWith('/wiki/') ? opts.site : wikiBase}${download}`;
      const filename = safeName(att.title || `${att.id}.bin`);
      const fileSize = att.extensions && typeof att.extensions.fileSize === 'number' ? att.extensions.fileSize : Number(att.extensions && att.extensions.fileSize);
      const baseEntry = {
        id: att.id,
        filename,
        url: fullUrl,
        mediaType: att.metadata && att.metadata.mediaType,
        fileSize: Number.isFinite(fileSize) ? fileSize : att.extensions && att.extensions.fileSize,
        version: att.version,
      };
      if (Number.isFinite(fileSize) && fileSize > opts.maxAttachmentBytes) {
        console.log(`Attachment ${filename} ... skipped (${formatBytes(fileSize)} > ${formatBytes(opts.maxAttachmentBytes)})`);
        manifest.push({
          ...baseEntry,
          skipped: true,
          reason: 'larger-than-max-attachment-size',
          maxAttachmentBytes: opts.maxAttachmentBytes,
        });
        continue;
      }
      const target = path.join(attachDir, filename);
      process.stdout.write(`Attachment ${filename} ... `);
      const res = await fetchWithRetry(fullUrl, { redirect: 'follow', headers: { Cookie: cookie, 'User-Agent': 'confluence-browser-fetch/1.0' } }, `attachment ${filename}`);
      if (!res.ok) {
        console.log(`HTTP ${res.status}`);
        manifest.push({ ...baseEntry, status: res.status });
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await fsp.writeFile(target, buf);
      console.log(`${buf.length} bytes`);
      manifest.push({ ...baseEntry, path: path.relative(outDir, target), downloadedBytes: buf.length, status: res.status });
    }
    const next = result.json._links && result.json._links.next;
    url = next ? `${wikiBase}${next}` : null;
  }

  await fsp.writeFile(path.join(outDir, 'attachments.json'), JSON.stringify(manifest, null, 2));
  return manifest.length;
}

async function fetchDescendants(pageId, cookie) {
  const ids = [];
  let url = `${wikiBase}/rest/api/content/${encodeURIComponent(pageId)}/descendant/page?limit=200&expand=space,version`;
  while (url) {
    const result = await fetchJson(url, cookie);
    if (result.status !== 200 || !result.json) throw new Error(`Descendants failed HTTP ${result.status}: ${(result.text || '').slice(0, 300)}`);
    for (const page of result.json.results || []) if (page.id) ids.push(String(page.id));
    const next = result.json._links && result.json._links.next;
    url = next ? `${wikiBase}${next}` : null;
  }
  return [...new Set(ids)];
}

async function readExistingMetadata(outDir) {
  try { return JSON.parse(await fsp.readFile(path.join(outDir, 'metadata.json'), 'utf8')); }
  catch { return null; }
}

async function fetchOnePage(pageId, cookie) {
  const { url: restUrl, page } = await fetchPageJson(pageId, cookie);
  const outDir = outputDirForPage(page);
  await fsp.mkdir(outDir, { recursive: true });

  const existing = await readExistingMetadata(outDir);
  if (opts.skipUnchanged && !opts.force && sameVersion(existing, page)) {
    console.log(`Skipped unchanged ${page.title} (${page.id}) version ${page.version && page.version.number} -> ${outDir}`);
    return { page, outDir, skipped: true };
  }

  await fsp.writeFile(path.join(outDir, 'page.json'), JSON.stringify(page, null, 2));
  await fsp.writeFile(path.join(outDir, 'page.storage.html'), (page.body && page.body.storage && page.body.storage.value) || '');
  await fsp.writeFile(path.join(outDir, 'page.view.html'), (page.body && page.body.view && page.body.view.value) || '');

  const webUrl = pageWebUrl(page);
  let browserStatus = 0;
  if (opts.browserHtml) {
    const html = await fetchText(webUrl, cookie, 'text/html');
    browserStatus = html.status;
    await fsp.writeFile(path.join(outDir, 'page.browser.html'), html.text);
  }

  let attachmentCount = 0;
  if (opts.attachments) attachmentCount = await downloadAttachments(page, cookie, outDir);

  const meta = {
    fetchedAt: new Date().toISOString(),
    id: page.id,
    title: page.title,
    type: page.type,
    status: page.status,
    space: page.space && { key: page.space.key, name: page.space.name },
    version: page.version,
    webUrl,
    restUrl,
    browserStatus,
    attachmentCount,
  };
  await fsp.writeFile(path.join(outDir, 'metadata.json'), JSON.stringify(meta, null, 2));

  console.log(`Saved ${page.title} (${page.id}) -> ${outDir}`);
  return { page, outDir, skipped: false };
}

async function main() {
  await fsp.mkdir(opts.rawDir, { recursive: true });
  const openUrl = inputs.find(i => /^https?:\/\//.test(i)) || wikiBase;
  const cookie = await getCookieWithWait(openUrl);

  const queue = [];
  const failed = [];
  const searches = [];

  for (const input of inputs) {
    try { queue.push({ id: await resolveInputToPageId(input, cookie), from: input }); }
    catch (e) { failed.push({ input, error: e.message }); console.error(`FAILED resolving ${input}: ${e.message}`); }
  }

  for (const title of opts.titles) {
    const cql = `${opts.space ? `space = ${cqlQuote(opts.space)} and ` : ''}type = page and title = ${cqlQuote(title)}`;
    opts.cqls.push(cql);
  }

  for (const cql of opts.cqls) {
    console.log(`Searching CQL: ${cql}`);
    try {
      const ids = await searchCql(cql, cookie);
      searches.push({ cql, ids });
      console.log(`CQL matched ${ids.length} page(s): ${ids.join(' ') || '(none)'}`);
      for (const id of ids) queue.push({ id, from: `CQL: ${cql}` });
    } catch (e) {
      failed.push({ input: `CQL: ${cql}`, error: e.message });
      console.error(`CQL FAILED: ${e.message}`);
    }
  }

  const seen = new Set();
  const fetched = [];
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (!item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    console.log(`\n===== Fetching Confluence page ${item.id}${item.from ? ` (${item.from})` : ''} =====`);
    try {
      const { page, outDir, skipped } = await fetchOnePage(item.id, cookie);
      fetched.push({ id: page.id, title: page.title, outDir, skipped });
      if (opts.descendants) {
        const descendants = await fetchDescendants(page.id, cookie);
        console.log(`Descendants: ${descendants.join(' ') || '(none)'}`);
        for (const id of descendants) if (!seen.has(id) && !queue.some(q => q.id === id)) queue.push({ id, from: `descendant of ${page.id}` });
      }
    } catch (e) {
      failed.push({ input: item.id, error: e.message });
      console.error(`FAILED page ${item.id}: ${e.message}`);
    }
  }

  const runMeta = { fetchedAt: new Date().toISOString(), site: opts.site, rawDir: opts.rawDir, inputs, searches, fetched, failed };
  await fsp.writeFile(path.join(opts.rawDir, 'confluence-browser-fetch-run.json'), JSON.stringify(runMeta, null, 2));

  if (failed.length) console.error(`\nCompleted with ${failed.length} failure(s). See ${path.join(opts.rawDir, 'confluence-browser-fetch-run.json')}`);
  else console.log(`\nCompleted successfully. See ${path.join(opts.rawDir, 'confluence-browser-fetch-run.json')}`);
}

main().catch(err => {
  console.error(`\nERROR: ${err.stack || err.message}`);
  process.exit(1);
});
