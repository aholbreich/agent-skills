#!/usr/bin/env node
'use strict';

const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { createBrowserSession } = require('./atlassian-browser');
const {
  parseSize,
  formatBytes,
  safeName,
  issueKeysFromText,
  parseBacklogInput,
  backlogApiUrl,
  issueKeysFromAgilePage,
  readExistingIssueJson,
  formatEta,
} = require('./lib');

function usage() {
  console.log(`Usage: jira-browser-fetch [ISSUE-KEY ...] [options]

Fetch Jira issue raw data via an already-authenticated browser session or by launching Chrome for SSO.
No Jira API token is required. Works well for Microsoft/Okta/SAML SSO setups.

Options:
  --server URL             Jira base URL (or set JIRA_SERVER), e.g. https://example.atlassian.net
  --raw-dir DIR            Output raw directory (default: JIRA_RAW_DIR or ./raw)
  --connected              Fetch connected/referenced tickets too
  --depth N                Connected fetch depth (default: 1 with --connected, otherwise 0)
  --scan-text              Include issue keys found anywhere in issue JSON/XML/HTML text
  --jql JQL                Search Jira with JQL and fetch all matching issues
  --backlog URL|BOARD_ID   Fetch all issues from a Jira Software board backlog URL or board id
  --assignee-me            Fetch all issues assigned to current Jira user
  --max-search-results N   Max issues to add per JQL/backlog search (default: 1000)
  --max-attachment-size S  Skip attachment downloads larger than S (default: 5mb; use unlimited to disable)
  --prefix A,B,C           Only fetch referenced keys with these project prefixes
  --wait SEC               Wait time for SSO/session per issue (default: 900)
  --port PORT              Chrome DevTools port (default: JIRA_CHROME_DEBUG_PORT, ATLASSIAN_CHROME_DEBUG_PORT, or 9223)
  --profile-dir DIR        Chrome profile dir (default: JIRA_CHROME_PROFILE, ATLASSIAN_CHROME_PROFILE, or ~/.local/share/atlassian-browser-chrome)
  --no-attachments         Do not download Jira attachments
  --no-html                Do not save browser HTML
  --no-xml                 Do not save Jira XML issue view
  --skip-existing          Skip issues that already have a valid raw/<KEY>/issue.json
                           (still extracts connected keys for depth traversal)
  --help                   Show this help

Examples:
  jira-browser-fetch SWING-4770 --raw-dir /path/wiki/raw
  jira-browser-fetch SWING-4770 --connected --prefix SWING,SSD,EC --raw-dir ./raw
  jira-browser-fetch --assignee-me --raw-dir ./raw
  jira-browser-fetch --backlog 'https://example.atlassian.net/jira/software/c/projects/ABC/boards/42/backlog?epics=visible' --raw-dir ./raw
  JIRA_SERVER=https://example.atlassian.net jira-browser-fetch --backlog 42 --connected
`);
}

const opts = {
  server: process.env.JIRA_SERVER || '',
  rawDir: process.env.JIRA_RAW_DIR || path.resolve(process.cwd(), 'raw'),
  port: Number(process.env.JIRA_CHROME_DEBUG_PORT || process.env.ATLASSIAN_CHROME_DEBUG_PORT || 9223),
  waitSec: Number(process.env.JIRA_FETCH_WAIT_SEC || 900),
  profileDir: process.env.JIRA_CHROME_PROFILE || process.env.ATLASSIAN_CHROME_PROFILE || path.join(os.homedir(), '.local/share/atlassian-browser-chrome'),
  connected: false,
  depth: undefined,
  scanText: false,
  jqls: [],
  backlogs: [],
  assigneeMe: false,
  maxSearchResults: Number(process.env.JIRA_MAX_SEARCH_RESULTS || 1000),
  maxAttachmentBytes: parseSize(process.env.JIRA_MAX_ATTACHMENT_SIZE || process.env.JIRA_MAX_ATTACHMENT_BYTES || '5mb'),
  prefixes: null,
  attachments: true,
  html: true,
  xml: true,
  skipExisting: false,
};
const issues = [];

for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '-h' || a === '--help') { usage(); process.exit(0); }
  else if (a === '--server') opts.server = process.argv[++i];
  else if (a === '--raw-dir') opts.rawDir = process.argv[++i];
  else if (a === '--connected') opts.connected = true;
  else if (a === '--depth') opts.depth = Number(process.argv[++i]);
  else if (a === '--scan-text') opts.scanText = true;
  else if (a === '--jql') opts.jqls.push(process.argv[++i]);
  else if (a === '--backlog') opts.backlogs.push(process.argv[++i]);
  else if (a === '--assignee-me') opts.assigneeMe = true;
  else if (a === '--max-search-results') opts.maxSearchResults = Number(process.argv[++i]);
  else if (a === '--max-attachment-size') opts.maxAttachmentBytes = parseSize(process.argv[++i]);
  else if (a === '--prefix') opts.prefixes = new Set(String(process.argv[++i] || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
  else if (a === '--wait') opts.waitSec = Number(process.argv[++i]);
  else if (a === '--port') opts.port = Number(process.argv[++i]);
  else if (a === '--profile-dir') opts.profileDir = process.argv[++i];
  else if (a === '--no-attachments') opts.attachments = false;
  else if (a === '--no-html') opts.html = false;
  else if (a === '--no-xml') opts.xml = false;
  else if (a === '--skip-existing') opts.skipExisting = true;
  else if (!a.startsWith('-')) issues.push(a.toUpperCase());
  else { console.error(`Unknown argument: ${a}`); process.exit(2); }
}

if (!issues.length && !opts.jqls.length && !opts.backlogs.length && !opts.assigneeMe) { usage(); process.exit(2); }
if (opts.assigneeMe) opts.jqls.push('assignee = currentUser() ORDER BY updated DESC');
if (opts.depth === undefined) opts.depth = opts.connected ? 1 : 0;
if (opts.depth > 0) opts.connected = true;
opts.server = opts.server.replace(/\/$/, '');
if (!opts.server) {
  console.error('Missing Jira server. Pass --server https://example.atlassian.net or set JIRA_SERVER.');
  process.exit(2);
}
opts.rawDir = path.resolve(opts.rawDir);

const issueKeyRe = /\b([A-Z][A-Z0-9]+)-(\d+)\b/g;

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
  return getSession().fetchJson(url, cookie, { accept: accept || 'application/json' });
}

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
    if (result.status === 401 || result.status === 403) {
      return { ok: false, message: `not authenticated yet (${result.status} from ${url})` };
    }
    if (result.status === 302 || result.status === 303) {
      return { ok: false, message: `still redirected to login (${result.status} from ${url})` };
    }
    if (result.status === 404) continue;
    return { ok: false, message: `session probe HTTP ${result.status} from ${url}` };
  }

  return { ok: false, message: 'could not verify Jira session' };
}

function getCookieWithWait(openUrl) {
  return getSession().getCookieWithWait(openUrl || `${opts.server}/`);
}

async function searchJql(jql) {
  const searchPageUrl = `${opts.server}/issues/?jql=${encodeURIComponent(jql)}`;
  const cookie = await getCookieWithWait(searchPageUrl);
  const found = [];
  let startAt = 0;
  const pageSize = Math.min(100, Math.max(1, opts.maxSearchResults || 1000));

  while (found.length < opts.maxSearchResults) {
    const limit = Math.min(pageSize, opts.maxSearchResults - found.length);
    const url = `${opts.server}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=key&maxResults=${limit}&startAt=${startAt}`;
    let result = await fetchJsonAdapter(url, cookie, 'application/json');

    if (result.status === 410 || result.status === 404 || !result.json || !Array.isArray(result.json.issues)) {
      const newUrl = `${opts.server}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=key&maxResults=${limit}`;
      result = await fetchJsonAdapter(newUrl, cookie, 'application/json');
    }

    if (result.status !== 200 || !result.json || !Array.isArray(result.json.issues)) {
      throw new Error(`JQL failed HTTP ${result.status}: ${(result.text || '').slice(0, 300)}`);
    }

    for (const issue of result.json.issues) if (issue.key) found.push(issue.key);
    if (result.json.isLast === true) break;
    if (typeof result.json.total === 'number' && startAt + result.json.issues.length >= result.json.total) break;
    if (!result.json.issues.length) break;
    startAt += result.json.issues.length;
  }

  return [...new Set(found)];
}

async function fetchBacklogPageWithWait(url, cookie) {
  const deadline = Date.now() + opts.waitSec * 1000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const result = await fetchJsonAdapter(url, cookie, 'application/json');
      if (result.status === 200 && result.json && Array.isArray(result.json.issues)) return result.json;
      last = `HTTP ${result.status} ${(result.text || '').slice(0, 180).replace(/\s+/g, ' ')}`;
    } catch (e) { last = e.message; }
    if (process.stdout.isTTY) {
      process.stdout.write(`\r${new Date().toLocaleTimeString()} waiting for Jira backlog access: ${last.padEnd(120).slice(0, 120)}`);
    }
    await sleep(3000);
  }
  if (process.stdout.isTTY) process.stdout.write('\n');
  throw new Error(`Could not fetch Jira backlog. Last result: ${last}`);
}

async function searchBacklog(input) {
  const backlog = parseBacklogInput(input, opts.server);
  const cookie = await getCookieWithWait(backlog.browseUrl);
  console.log(`Waiting up to ${opts.waitSec}s for Jira backlog access...`);

  const found = [];
  let startAt = 0;
  const pageSize = Math.min(100, Math.max(1, opts.maxSearchResults || 1000));

  while (found.length < opts.maxSearchResults) {
    const limit = Math.min(pageSize, opts.maxSearchResults - found.length);
    const url = backlogApiUrl(opts.server, backlog.boardId, startAt, limit);
    const page = await fetchBacklogPageWithWait(url, cookie);
    const keys = issueKeysFromAgilePage(page);
    for (const key of keys) found.push(key);
    console.log(`Fetched backlog page board=${backlog.boardId} startAt=${startAt}, issues=${keys.length}${typeof page.total === 'number' ? `, total=${page.total}` : ''}`);
    if (page.isLast === true) break;
    if (typeof page.total === 'number' && startAt + keys.length >= page.total) break;
    if (!keys.length) break;
    startAt += keys.length;
  }

  const keys = [...new Set(found)];
  const manifest = {
    fetchedAt: new Date().toISOString(),
    server: opts.server,
    boardId: backlog.boardId,
    source: backlog.source,
    browseUrl: backlog.browseUrl,
    endpoint: `/rest/agile/1.0/board/${backlog.boardId}/backlog`,
    issueCount: keys.length,
    issues: keys,
  };
  await fsp.writeFile(path.join(opts.rawDir, `jira-board-${backlog.boardId}-backlog.json`), JSON.stringify(manifest, null, 2));
  return manifest;
}

function addKey(set, key) {
  if (!key) return;
  key = String(key).toUpperCase();
  const m = /^([A-Z][A-Z0-9]+)-\d+$/.exec(key);
  if (!m) return;
  if (opts.prefixes && !opts.prefixes.has(m[1])) return;
  set.add(key);
}

function scanIssueKeys(text, set) {
  if (!text) return;
  for (const key of issueKeysFromText(text)) addKey(set, key);
}

function extractConnectedKeys(issueJson, rawTexts) {
  const found = new Set();
  const fields = issueJson && issueJson.fields || {};

  if (fields.parent) addKey(found, fields.parent.key);
  for (const st of fields.subtasks || []) addKey(found, st.key);
  for (const link of fields.issuelinks || []) {
    if (link.inwardIssue) addKey(found, link.inwardIssue.key);
    if (link.outwardIssue) addKey(found, link.outwardIssue.key);
  }

  // Jira custom fields often contain Epic Link / parent keys as strings.
  for (const v of Object.values(fields)) {
    if (typeof v === 'string') addKey(found, v);
    else if (v && typeof v === 'object' && typeof v.key === 'string') addKey(found, v.key);
  }

  if (opts.scanText) {
    for (const text of rawTexts) scanIssueKeys(text, found);
  }

  if (issueJson && issueJson.key) found.delete(issueJson.key);
  return [...found].sort();
}

async function downloadAttachments(issueJson, cookie, outDir) {
  const attachments = (((issueJson || {}).fields || {}).attachment) || [];
  const attachDir = path.join(outDir, 'attachments');
  await fsp.mkdir(attachDir, { recursive: true });
  const manifest = [];

  for (const att of attachments) {
    if (!att.content) continue;
    const filename = safeName(att.filename || `${att.id || 'attachment'}.bin`);
    const size = typeof att.size === 'number' ? att.size : Number(att.size);
    const baseEntry = {
      id: att.id,
      filename,
      url: att.content,
      mimeType: att.mimeType,
      size: Number.isFinite(size) ? size : att.size,
      author: att.author && (att.author.displayName || att.author.emailAddress || att.author.accountId),
      created: att.created,
    };
    if (Number.isFinite(size) && size > opts.maxAttachmentBytes) {
      console.log(`Attachment ${filename} ... skipped (${formatBytes(size)} > ${formatBytes(opts.maxAttachmentBytes)})`);
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
    const res = await fetch(att.content, {
      redirect: 'follow',
      headers: { Cookie: cookie, 'User-Agent': 'jira-browser-fetch/1.0' },
    });
    if (!res.ok) {
      console.log(`HTTP ${res.status}`);
      manifest.push({ ...baseEntry, status: res.status });
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await fsp.writeFile(target, buf);
    console.log(`${buf.length} bytes`);
    manifest.push({
      ...baseEntry,
      path: path.relative(outDir, target),
      downloadedBytes: buf.length,
      status: res.status,
    });
  }

  await fsp.writeFile(path.join(outDir, 'attachments.json'), JSON.stringify(manifest, null, 2));
  return manifest.length;
}

async function fetchIssue(issue) {
  const outDir = path.join(opts.rawDir, issue);

  if (opts.skipExisting) {
    const existing = await readExistingIssueJson(outDir, issue);
    if (existing) {
      console.log(`Skipping ${issue} (already fetched: ${outDir})`);
      try {
        const saved = JSON.parse(await fsp.readFile(path.join(outDir, 'connected-keys.json'), 'utf8'));
        if (Array.isArray(saved)) return saved;
      } catch {}
      return extractConnectedKeys(existing, []);
    }
  }

  await fsp.mkdir(outDir, { recursive: true });

  const browseUrl = `${opts.server}/browse/${issue}`;
  const restUrl = `${opts.server}/rest/api/3/issue/${issue}?expand=renderedFields,names,schema,changelog`;
  const remoteLinksUrl = `${opts.server}/rest/api/3/issue/${issue}/remotelink`;
  const xmlUrl = `${opts.server}/si/jira.issueviews:issue-xml/${issue}/${issue}.xml`;

  const cookie = await getCookieWithWait(browseUrl);

  const rest = await fetchJsonAdapter(restUrl, cookie, 'application/json');
  if (rest.status !== 200 || !rest.json || rest.json.key !== issue) {
    throw new Error(`Could not fetch ${issue}. HTTP ${rest.status}: ${(rest.text || '').slice(0, 300).replace(/\s+/g, ' ')}`);
  }

  await fsp.writeFile(path.join(outDir, 'issue.json'), rest.text);
  console.log(`Saved ${path.join(outDir, 'issue.json')}`);

  let html = { status: 0, text: '' };
  if (opts.html) {
    html = await fetchTextAdapter(browseUrl, cookie, 'text/html');
    await fsp.writeFile(path.join(outDir, 'issue.html'), html.text);
    console.log(`Saved ${path.join(outDir, 'issue.html')} (HTTP ${html.status})`);
  }

  let xml = { status: 0, text: '' };
  if (opts.xml) {
    xml = await fetchTextAdapter(xmlUrl, cookie, 'application/xml,text/xml,text/html');
    await fsp.writeFile(path.join(outDir, 'issue.xml'), xml.text);
    console.log(`Saved ${path.join(outDir, 'issue.xml')} (HTTP ${xml.status})`);
  }

  const remoteLinks = await fetchTextAdapter(remoteLinksUrl, cookie, 'application/json');
  await fsp.writeFile(path.join(outDir, 'remotelinks.json'), remoteLinks.text);
  console.log(`Saved ${path.join(outDir, 'remotelinks.json')} (HTTP ${remoteLinks.status})`);

  let parsed = null;
  try { parsed = JSON.parse(rest.text); } catch {}

  const rawTexts = [rest.text, html.text, xml.text, remoteLinks.text];
  const connected = extractConnectedKeys(parsed, rawTexts);
  await fsp.writeFile(path.join(outDir, 'connected-keys.json'), JSON.stringify(connected, null, 2));

  const meta = {
    fetchedAt: new Date().toISOString(),
    issue,
    source: browseUrl,
    restUrl,
    htmlStatus: html.status,
    xmlStatus: xml.status,
    remoteLinksStatus: remoteLinks.status,
    connectedKeys: connected,
  };
  await fsp.writeFile(path.join(outDir, 'metadata.json'), JSON.stringify(meta, null, 2));

  let attachmentCount = 0;
  if (opts.attachments) attachmentCount = await downloadAttachments(parsed, cookie, outDir);

  console.log(`Connected keys: ${connected.join(' ') || '(none)'}`);
  console.log(`Attachments processed: ${attachmentCount}`);
  console.log(`Done: ${outDir}`);
  return connected;
}

async function main() {
  await fsp.mkdir(opts.rawDir, { recursive: true });
  const queue = issues.map(k => ({ key: k, depth: 0, from: null }));
  const seen = new Set();
  const failed = [];
  const searches = [];
  const backlogs = [];

  for (const backlogInput of opts.backlogs) {
    console.log(`\n===== Fetching Jira backlog: ${backlogInput} =====`);
    try {
      const backlog = await searchBacklog(backlogInput);
      backlogs.push(backlog);
      console.log(`Backlog board ${backlog.boardId} matched ${backlog.issueCount} issue(s): ${backlog.issues.join(' ') || '(none)'}`);
      for (const key of backlog.issues) {
        if (!queue.some(q => q.key === key)) queue.push({ key, depth: 0, from: `Backlog board ${backlog.boardId}` });
      }
    } catch (e) {
      failed.push({ key: `BACKLOG: ${backlogInput}`, error: e.message });
      console.error(`BACKLOG FAILED: ${e.message}`);
    }
  }

  for (const jql of opts.jqls) {
    console.log(`\n===== Searching JQL: ${jql} =====`);
    try {
      const keys = await searchJql(jql);
      searches.push({ jql, keys });
      console.log(`JQL matched ${keys.length} issue(s): ${keys.join(' ') || '(none)'}`);
      for (const key of keys) {
        if (!queue.some(q => q.key === key)) queue.push({ key, depth: 0, from: `JQL: ${jql}` });
      }
    } catch (e) {
      failed.push({ key: `JQL: ${jql}`, error: e.message });
      console.error(`JQL FAILED: ${e.message}`);
    }
  }

  const fetchStart = Date.now();
  let processed = 0;
  for (let idx = 0; idx < queue.length; idx++) {
    const item = queue[idx];
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    const pct = ((idx + 1) / queue.length * 100).toFixed(0);
    console.log(`\n===== [${idx + 1}/${queue.length}] ${pct}% Fetching ${item.key}${item.from ? ` (referenced by ${item.from})` : ''} =====`);
    try {
      const connected = await fetchIssue(item.key);
      if (opts.connected && item.depth < opts.depth) {
        for (const key of connected) {
          if (!seen.has(key) && !queue.some(q => q.key === key)) queue.push({ key, depth: item.depth + 1, from: item.key });
        }
      }
    } catch (e) {
      failed.push({ key: item.key, error: e.message });
      console.error(`SKIPPED/FAILED ${item.key}: ${e.message}`);
    }
    processed++;
    const remaining = queue.length - (idx + 1);
    if (queue.length > 1 && remaining > 0) {
      const elapsed = (Date.now() - fetchStart) / 1000;
      const eta = elapsed / processed * remaining;
      console.log(`Progress: ${idx + 1}/${queue.length} done, ${remaining} remaining, elapsed ${formatEta(elapsed)}, ETA ${formatEta(eta)}`);
    }
  }

  const runMeta = { fetchedAt: new Date().toISOString(), server: opts.server, rawDir: opts.rawDir, requested: issues, searches, backlogs, fetched: [...seen].filter(k => !failed.some(f => f.key === k)), failed };
  await fsp.writeFile(path.join(opts.rawDir, 'jira-browser-fetch-run.json'), JSON.stringify(runMeta, null, 2));

  if (failed.length) {
    console.error(`\nCompleted with ${failed.length} failed issue(s). See ${path.join(opts.rawDir, 'jira-browser-fetch-run.json')}`);
  } else {
    console.log(`\nCompleted successfully. See ${path.join(opts.rawDir, 'jira-browser-fetch-run.json')}`);
  }
}

main().catch(err => {
  console.error(`\nERROR: ${err.stack || err.message}`);
  process.exit(1);
});
