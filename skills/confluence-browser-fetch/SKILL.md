---
name: confluence-browser-fetch
description: Fetch Confluence Cloud pages through an authenticated Chrome browser session when API tokens do not work, especially with Microsoft/SSO. Use to archive Confluence page JSON, storage/view HTML, browser HTML, attachments, CQL search results, or page descendants into a raw wiki folder.
license: MIT
compatibility: Agent Skills standard. Tested with Pi; installable into Claude Code, Codex, OpenClaw/generic .agents skills directories. Requires Node.js 22+ with built-in fetch/WebSocket and a Chromium-compatible browser with remote debugging (Chrome, Chromium, Brave, Edge, or Vivaldi). No npm dependencies.
---

# Confluence Browser Fetch

Use this skill when a user wants Confluence pages ingested into an LLM wiki `raw/` folder and normal Atlassian API-token auth is unavailable or inconvenient due to SSO.

The script opens/reuses Chrome with a dedicated profile, lets the user complete SSO once, extracts Atlassian cookies via Chrome DevTools, verifies they represent an authenticated Confluence REST session, and fetches Confluence REST data plus rendered page HTML and attachments.

## Safety

- Never ask users to paste Confluence cookies or API tokens into chat.
- Prefer browser automation so secrets remain in the local Chrome profile.
- Treat fetched pages and attachments as confidential.
- This skill is read-only: do not create, edit, delete, or move Confluence pages.

## Script

```bash
scripts/confluence-browser-fetch.js <URL|PAGE-ID> [...] [options]
```

Important options:

```bash
--site URL               Atlassian site, e.g. https://example.atlassian.net
--raw-dir DIR            output raw directory
--space KEY              Confluence space key for --title search
--title TITLE            resolve and fetch page by exact title
--cql CQL                search Confluence and fetch matching pages
--descendants            fetch descendant pages
--max-search-results N   limit CQL result fetches
--max-attachment-size S  skip attachment files larger than S (default 5mb; use unlimited to disable)
--force                  re-fetch even when local page version is current
--no-skip-unchanged      disable version/timestamp skip check
--retries N              retry transient HTTP failures
--request-timeout SEC    per-request timeout
--no-attachments         skip attachments
--no-browser-html        skip rendered browser HTML
```

## Shared Atlassian SSO Session

All five Atlassian skills (`jira-browser-fetch`, `jira-update`, `confluence-browser-fetch`, `confluence-update`, `bitbucket-browser-fetch`) default to the same Chrome profile (`~/.local/share/atlassian-browser-chrome`) and DevTools port (`9223`). Log in once via any skill and the others reuse that session automatically — no env vars needed.

**This is a separate Chrome window from any browser the user already has open.** The script always launches its own profile with remote-debugging enabled; cookies from the user's regular Chrome are not read. The user logs in inside the window the script opens; that session is then reused by every Atlassian skill until it expires.

**Reuse signal.** When attaching to an existing session, the script prints `Reusing Chrome DevTools on port 9223` and (if the target tab is open) `Found existing tab for <host>`. When you see those lines, do not ask the user to re-SSO — the session is already valid.

If Chrome/Chromium is installed via Flatpak, Snap, or another non-PATH location, set `CHROME=/path/to/launcher` (or a wrapper script) so the script can find the binary.

Override with `ATLASSIAN_CHROME_PROFILE` and/or `ATLASSIAN_CHROME_DEBUG_PORT` to relocate the shared profile/port, or use skill-specific `*_CHROME_PROFILE` / `*_CHROME_DEBUG_PORT` env vars for isolation.

## Typical Workflow

1. If the user gives a Confluence URL, run the script directly with that URL.
2. If the user gives a title, ask for the space key or use `--cql`.
3. Show the command before running it.
4. If Chrome opens (first run or expired session), ask the user to complete SSO in that window. On subsequent invocations the script reuses the session silently — see the Reuse signal above.
5. Verify saved files.
6. If this is an LLM wiki ingest, process the saved `raw/confluence/...` material into `wiki/` per the project `AGENTS.md`.

Example:

```bash
scripts/confluence-browser-fetch.js \
  "https://example.atlassian.net/wiki/spaces/ABC/pages/123456/Page+Title" \
  --site https://example.atlassian.net \
  --raw-dir ./raw
```

Fetch a page and all descendants:

```bash
scripts/confluence-browser-fetch.js \
  123456 \
  --site https://example.atlassian.net \
  --raw-dir ./raw \
  --descendants
```

Fetch by CQL:

```bash
scripts/confluence-browser-fetch.js \
  --site https://example.atlassian.net \
  --raw-dir ./raw \
  --cql 'space = ABC and type = page and text ~ "billing"'
```

## Output Layout

```text
raw/confluence/<SPACE>/<PAGE-ID>-<slug>/
├── page.json          # Confluence REST content with storage/view HTML and metadata
├── page.storage.html  # Confluence storage format
├── page.view.html     # REST-rendered view body
├── page.browser.html  # browser page HTML, if enabled
├── metadata.json      # fetch metadata
├── attachments.json   # attachment manifest, including skipped large-file references
└── attachments/       # downloaded attachments under max-size threshold
```

A run manifest is written to:

```text
raw/confluence-browser-fetch-run.json
```

## Installation / PATH

Use directly by path, or install a symlink:

```bash
mkdir -p ~/.local/bin
ln -sf ~/.pi/agent/skills/confluence-browser-fetch/scripts/confluence-browser-fetch.js ~/.local/bin/confluence-browser-fetch
```

## References

- [Usage reference](references/usage.md)
- [Distribution guide](references/distribution.md)
