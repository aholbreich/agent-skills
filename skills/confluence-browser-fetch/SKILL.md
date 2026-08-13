---
name: confluence-browser-fetch
description: Fetch Confluence Cloud or Server/Data Center pages through a dedicated authenticated browser when API tokens do not work, especially with Microsoft/SSO. Supports native Chromium and managed Windows Chrome/Edge from WSL without exporting cookies. Archive page JSON, storage/view HTML, attachments, CQL results, or descendants into a raw folder.
license: MIT
compatibility: Agent Skills standard. Tested with Pi; installable into Claude Code, Codex, OpenClaw/generic .agents skills directories. Requires Node.js 22+ and Chromium, or Windows Chrome/Edge when run under WSL with mirrored localhost networking. No npm dependencies.
---

# Confluence Browser Fetch

Use this read-only skill to ingest authenticated Confluence pages into an LLM wiki or evidence folder when ordinary API-token authentication is unavailable or inappropriate.

It supports:

- Confluence Cloud, normally under `/wiki`;
- Confluence Server/Data Center at `/` or a custom context path;
- native Chrome/Chromium/Brave/Edge/Vivaldi on Linux/macOS;
- managed Windows Chrome or Edge launched from WSL;
- page ID/URL acquisition, title lookup, CQL, immediate children or full descendants, version-aware refresh, and bounded attachments.

## Authentication and safety

The fetcher opens or reuses a **dedicated browser profile** and lets the user complete normal SSO/MFA. It then performs same-origin `GET` requests inside the authenticated Confluence tab with `credentials: include`.

For this skill:

- browser cookies are not read, returned, printed, or replayed by Node;
- CDP cookie/storage APIs are not used;
- cross-origin requests and redirects are rejected;
- no create, update, delete, move, form-submit, or other write operation is available;
- attachment transfer is bounded even if `unlimited` is requested;
- fetched pages and attachments must be treated as confidential.

CDP remains a powerful local control interface. Use only the dedicated profile, keep DevTools on loopback, and close the dedicated browser when it is no longer needed.

## Basic commands

An absolute page URL supplies both the site and page ID:

```bash
scripts/confluence-browser-fetch.js \
  'https://example.atlassian.net/wiki/spaces/ABC/pages/123456/Page+Title' \
  --raw-dir ./raw
```

Classic Server/Data Center URLs are supported:

```bash
scripts/confluence-browser-fetch.js \
  'https://confluence.example.com/pages/viewpage.action?pageId=123456' \
  --raw-dir ./raw
```

A page ID requires `--site`:

```bash
scripts/confluence-browser-fetch.js 123456 \
  --site https://confluence.example.com \
  --context-path / \
  --raw-dir ./raw
```

Custom reverse-proxy context:

```bash
scripts/confluence-browser-fetch.js 123456 \
  --site https://intranet.example.com \
  --context-path /confluence \
  --raw-dir ./raw
```

## Important options

```text
--site URL               origin/application URL; optional for absolute page URLs
--context-path PATH      auto (default), /wiki, /, or custom path
--raw-dir DIR            output raw directory
--space KEY              constrain exact-title lookup
--title TITLE            resolve a page by exact title
--cql CQL                search and fetch matching pages
--children               fetch immediate children only (one level)
--descendants            fetch all descendant pages
--max-search-results N   bound CQL results
--max-attachment-size S  default 5mb
--force                  fetch despite matching local version
--no-skip-unchanged      disable version comparison
--no-attachments         skip all attachment downloads
--no-browser-html        omit browser HTML response
--browser-backend NAME   auto, native, or windows-wsl
--browser NAME           chrome or edge for Windows/WSL
--profile-dir PATH       dedicated profile path; Windows syntax for windows-wsl
--port PORT              loopback DevTools port, default 9223
--wait SEC               SSO wait, default 900
```

## Deployment detection

With `--context-path auto`, the fetcher infers:

- `/wiki` from Cloud-style URLs or `*.atlassian.net` sites;
- `/` from classic `/pages/viewpage.action`, `/pages/releaseview.action`, `/display/...`, or root `/spaces/...` URLs;
- a custom prefix from URLs such as `/confluence/pages/viewpage.action`.

Use explicit `--context-path` when a reverse proxy or unusual URL does not expose enough information.

## Windows/WSL

On WSL, `--browser-backend auto` selects `windows-wsl` when `powershell.exe` is available. The launcher uses Windows Chrome by default and stores its dedicated profile at:

```text
%LOCALAPPDATA%\AgentSkillsBrowserProfiles\Atlassian
```

The launcher marks profiles it creates and refuses to use a non-empty, unmarked profile directory. It also refuses a DevTools port owned by a different browser/profile.

Requirements:

- Windows Chrome or Edge;
- PowerShell interoperability from WSL;
- mirrored localhost networking, or another setup where WSL can reach Windows `127.0.0.1:<port>`;
- no firewall/LAN exposure of the DevTools port.

Use Edge if required by corporate policy:

```bash
scripts/confluence-browser-fetch.js '<URL>' --browser-backend windows-wsl --browser edge --raw-dir ./raw
```

## Typical workflow

1. Run the fetcher with the supplied page URL.
2. If the dedicated browser opens or the session expired, complete SSO/MFA there.
3. Do not ask the user to paste cookies, SAML data, passwords, or tokens.
4. Verify `page.json`, metadata, and capture status before synthesis.
5. For an LLM wiki, process `raw/confluence/...` according to that repository's evidence rules.
6. Do not commit private exports to a public repository.

For a first fetch from a sensitive site, prefer:

```bash
scripts/confluence-browser-fetch.js '<URL>' --no-attachments --raw-dir ./raw
```

Then enable bounded attachment capture only when needed.

## Output

```text
raw/confluence/<SPACE>/<PAGE-ID>-<slug>/
├── page.json
├── page.storage.html
├── page.view.html
├── page.browser.html
├── metadata.json
├── attachments.json
└── attachments/
```

The run manifest is:

```text
raw/confluence-browser-fetch-run.json
```

Metadata records the origin, context path, REST source URL, browser backend, and `browser-context-get` authentication transport. It never records browser credentials.

## References

- [Usage and troubleshooting](references/usage.md)
- [Architecture and development](references/development.md)
- [Distribution guide](references/distribution.md)
