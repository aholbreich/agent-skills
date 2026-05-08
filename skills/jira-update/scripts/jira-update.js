#!/usr/bin/env node
'use strict';

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
  if (!args.length || args[0].startsWith('-')) {
    console.error(`${opts.command} requires an issue key as the first argument.`);
    process.exit(2);
  }
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

if (!opts.server) {
  console.error('Missing Jira server. Pass --server https://example.atlassian.net or set JIRA_SERVER.');
  process.exit(2);
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

async function runUnimplemented() {
  console.error(`Command "${opts.command}" not yet implemented.`);
  process.exit(1);
}

async function main() {
  await fsp.mkdir(opts.rawDir, { recursive: true });
  switch (opts.command) {
    case 'create': return runCreate();
    case 'comment': return runComment();
    case 'transition': return runTransition();
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
