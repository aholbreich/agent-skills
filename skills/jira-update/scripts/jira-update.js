#!/usr/bin/env node
'use strict';

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
let createBrowserSession;
try {
  ({ createBrowserSession } = require('./atlassian-browser'));
} catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND') throw e;
  console.error('scripts/atlassian-browser.js is missing — this skill install is incomplete.');
  console.error('Reinstall: npx skills add aholbreich/agent-skills');
  process.exit(1);
}
const lib = require('./lib');

const COMMON_OPTIONS = `Common options:
  --server URL          Jira base URL (or JIRA_SERVER), e.g. https://example.atlassian.net
  --raw-dir DIR         Audit directory (default: ./raw)
  --apply               Actually write to Jira (without it, dry-run only)
  --message TEXT        Annotate the local audit record
  --wait SEC            Wait time for SSO/session (default: 900)
  --port PORT           Chrome DevTools port (default: JIRA_CHROME_DEBUG_PORT, ATLASSIAN_CHROME_DEBUG_PORT, or 9223)
  --profile-dir DIR     Chrome profile dir (default: JIRA_CHROME_PROFILE, ATLASSIAN_CHROME_PROFILE, or ~/.local/share/atlassian-browser-chrome)`;

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

${COMMON_OPTIONS}
`);
}

const COMMAND_HELP = {
  create: `Usage: jira-update create [options]

Create a new Jira issue from a JSON manifest.

Required:
  --file FILE              Manifest JSON. Must include: project, issueType, summary.
                           Optional: description, descriptionRepresentation (markdown|adf, default markdown),
                           labels, assignee ("accountId:..." or bare name), priority, parent, fields (escape hatch).

${COMMON_OPTIONS}
`,
  comment: `Usage: jira-update comment ISSUE-KEY [options]

Add a comment to an existing issue.

Required:
  --file FILE              Comment body source.
  --representation REP     markdown (default) or adf.

${COMMON_OPTIONS}
`,
  transition: `Usage: jira-update transition ISSUE-KEY [options]

Move an issue through its workflow.

Required (one of):
  --to NAME                Transition name, case-insensitive (e.g. "In Progress").
  --to-id ID               Transition id (skips name lookup).

Optional:
  --comment-file FILE      Comment to attach to the transition.
  --representation REP     markdown (default) or adf for the comment file.
  --field key=value        Set a field as part of the transition. Repeatable.

--field key=value heuristics:
  priority, resolution, status   wrapped as { name: VALUE }
  labels, components, fixVersions  split on commas; labels become a string array;
                                   components/fixVersions become [{name},...]
  any other key                  passed through as a plain string

${COMMON_OPTIONS}
`,
  'update-fields': `Usage: jira-update update-fields ISSUE-KEY [options]

Partial field update (PUT /issue/{key}). Does NOT detect concurrent edits;
re-fetch with jira-browser-fetch first if drift matters.

Required:
  --file FILE              JSON manifest with a top-level "fields" object.
                           Values are sent verbatim — caller is responsible for shape
                           (e.g. labels: ["a","b"], priority: { name: "High" }).

${COMMON_OPTIONS}
`,
  link: `Usage: jira-update link FROM-KEY [options]

Create an issue link between two issues.

Required:
  --to ISSUE-KEY           Target issue key (validated as PROJ-123 form).
  --type LINK-TYPE         Link type by name, inward, or outward
                           (e.g. "blocks", "is blocked by", "relates to").

${COMMON_OPTIONS}
`,
};

function commandHelp(command) {
  if (COMMAND_HELP[command]) {
    console.log(COMMAND_HELP[command]);
  } else {
    topUsage();
  }
}

const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;
function validIssueKey(s) {
  return ISSUE_KEY_RE.test(String(s || ''));
}

const opts = {
  command: '',
  issueKey: '',
  server: process.env.JIRA_SERVER || '',
  rawDir: process.env.JIRA_UPDATE_RAW_DIR || process.env.JIRA_RAW_DIR || path.resolve(process.cwd(), 'raw'),
  port: Number(process.env.JIRA_CHROME_DEBUG_PORT || process.env.ATLASSIAN_CHROME_DEBUG_PORT || 9223),
  waitSec: Number(process.env.JIRA_UPDATE_WAIT_SEC || 900),
  profileDir: process.env.JIRA_CHROME_PROFILE || process.env.ATLASSIAN_CHROME_PROFILE || path.join(os.homedir(), '.local/share/atlassian-browser-chrome'),
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

if (args.includes('--help') || args.includes('-h')) {
  commandHelp(opts.command);
  process.exit(0);
}

if (['comment', 'transition', 'update-fields', 'link'].includes(opts.command)) {
  if (!args.length || args[0].startsWith('-')) {
    console.error(`error: ${opts.command} requires an issue key as the first argument (e.g. PROJ-123).`);
    process.exit(2);
  }
  opts.issueKey = args.shift();
  if (!validIssueKey(opts.issueKey)) {
    console.error(`error: invalid issue key "${opts.issueKey}". Expected format like PROJ-123 (uppercase letters, then "-", then digits).`);
    process.exit(2);
  }
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

if (opts.command === 'link' && opts.to && !validIssueKey(opts.to)) {
  console.error(`error: invalid --to issue key "${opts.to}". Expected format like PROJ-123.`);
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

async function main() {
  await fsp.mkdir(opts.rawDir, { recursive: true });
  switch (opts.command) {
    case 'create': return runCreate();
    case 'comment': return runComment();
    case 'transition': return runTransition();
    case 'update-fields': return runUpdateFields();
    case 'link': return runLink();
    default:
      throw new Error(`Unhandled command: ${opts.command}`);
  }
}

main().catch(err => {
  if (err && err.name === 'UsageError') {
    console.error(`error: ${err.message}`);
    process.exit(2);
  }
  console.error(`\nERROR: ${err.stack || err.message}`);
  process.exit(1);
});
