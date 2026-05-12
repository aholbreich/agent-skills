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
  --port PORT               Chrome DevTools port (default: BITBUCKET_CHROME_DEBUG_PORT, ATLASSIAN_CHROME_DEBUG_PORT, or 9223)
  --profile-dir DIR         Chrome profile dir (default: BITBUCKET_CHROME_PROFILE, ATLASSIAN_CHROME_PROFILE, or ~/.local/share/atlassian-browser-chrome)
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
  port: Number(process.env.BITBUCKET_CHROME_DEBUG_PORT || process.env.ATLASSIAN_CHROME_DEBUG_PORT || 9223),
  waitSec: Number(process.env.BITBUCKET_FETCH_WAIT_SEC || 900),
  profileDir: process.env.BITBUCKET_CHROME_PROFILE || process.env.ATLASSIAN_CHROME_PROFILE || path.join(os.homedir(), '.local/share/atlassian-browser-chrome'),
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

async function fetchJson(url, cookie) {
  return getSession().fetchJson(url, cookie, { accept: 'application/json' });
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

function getCookieWithWait() {
  return getSession().getCookieWithWait(project.browseUrl);
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
