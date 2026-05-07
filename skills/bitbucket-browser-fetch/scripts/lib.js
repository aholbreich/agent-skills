'use strict';

function parseProjectInput(input) {
  const source = String(input || '').trim();
  if (!source) throw new Error('Missing Bitbucket project URL');
  try {
    const url = new URL(source);
    if (url.hostname !== 'bitbucket.org') throw new Error('Expected bitbucket.org URL');
    const parts = url.pathname.split('/').filter(Boolean);
    // https://bitbucket.org/{workspace}/workspace/projects/{projectKey}
    if (parts.length >= 4 && parts[1] === 'workspace' && parts[2] === 'projects') {
      return { source, workspace: parts[0], projectKey: parts[3].toUpperCase(), browseUrl: `https://bitbucket.org/${parts[0]}/workspace/projects/${parts[3].toUpperCase()}` };
    }
  } catch (e) {
    if (e.message !== 'Invalid URL') throw e;
  }
  throw new Error(`Could not parse Bitbucket project URL: ${input}`);
}

function repositoriesApiUrl(workspace, projectKey, page = 1, pagelen = 100) {
  const url = new URL(`https://bitbucket.org/!api/internal/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(projectKey)}/repositories`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('pagelen', String(pagelen));
  url.searchParams.set('sort', 'name');
  url.searchParams.set('fields', '+values.parent');
  return url.toString().replace('%2Bvalues.parent', '%2Bvalues.parent');
}

function cloneLinks(repo) {
  const links = (((repo || {}).links || {}).clone || []);
  const out = {};
  for (const link of links) {
    if (link && link.name && link.href) out[link.name] = link.href;
  }
  const fullName = repo.full_name || (repo.workspace && repo.slug ? `${repo.workspace.slug}/${repo.slug}` : '');
  if (fullName) {
    if (!out.ssh) out.ssh = `git@bitbucket.org:${fullName}.git`;
    if (!out.https) out.https = `https://bitbucket.org/${fullName}.git`;
  }
  return out;
}

function normalizeRepo(repo) {
  const project = repo.project || {};
  const links = repo.links || {};
  const htmlUrl = links.html && links.html.href || (repo.full_name ? `https://bitbucket.org/${repo.full_name}` : '');
  return {
    uuid: repo.uuid,
    name: repo.name,
    slug: repo.slug,
    fullName: repo.full_name,
    projectKey: project.key,
    projectName: project.name,
    isPrivate: repo.is_private,
    scm: repo.scm,
    mainBranch: repo.mainbranch && repo.mainbranch.name,
    createdOn: repo.created_on,
    updatedOn: repo.updated_on,
    size: repo.size,
    language: repo.language,
    htmlUrl,
    clone: cloneLinks(repo),
  };
}

function safeName(s) {
  return String(s || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function repositoriesMarkdown(manifest) {
  const lines = [];
  lines.push(`# Bitbucket repositories: ${manifest.workspace} / ${manifest.projectKey}`);
  lines.push('');
  lines.push(`Fetched: ${manifest.fetchedAt}`);
  lines.push(`Count: ${manifest.repositoryCount}`);
  lines.push('');
  lines.push('| Repository | Private | SSH clone | URL |');
  lines.push('|---|---:|---|---|');
  for (const repo of manifest.repositories) {
    lines.push(`| ${repo.fullName || repo.name || ''} | ${repo.isPrivate ? 'yes' : 'no'} | \`${repo.clone && repo.clone.ssh || ''}\` | ${repo.htmlUrl || ''} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function cloneScript() {
  return `#!/usr/bin/env bash
set -euo pipefail
TARGET_DIR="\${1:-repos}"
mkdir -p "$TARGET_DIR"
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
while IFS= read -r url; do
  [ -n "$url" ] || continue
  name="$(basename "$url" .git)"
  if [ -d "$TARGET_DIR/$name/.git" ]; then
    echo "SKIP $name"
  else
    echo "CLONE $url -> $TARGET_DIR/$name"
    git clone "$url" "$TARGET_DIR/$name"
  fi
done < "$SCRIPT_DIR/clone-ssh.txt"
`;
}

module.exports = {
  parseProjectInput,
  repositoriesApiUrl,
  cloneLinks,
  normalizeRepo,
  safeName,
  repositoriesMarkdown,
  cloneScript,
};
