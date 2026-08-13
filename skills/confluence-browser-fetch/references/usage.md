# Confluence Browser Fetch Usage

## Authentication model

The fetcher uses an authenticated browser when API tokens are unavailable or SSO/device policy requires an interactive browser:

1. Launch or reuse a dedicated Chromium profile.
2. Complete normal SSO/MFA in that browser when prompted.
3. Select a tab whose exact origin matches the configured Confluence origin.
4. Execute same-origin read-only `fetch()` requests in the page context.
5. Return response data—not browser credentials—to Node for storage.

The Confluence fetch path does not invoke CDP cookie/storage APIs and does not construct Cookie headers.

## Requirements

- Node.js 22+ with built-in `fetch` and `WebSocket`.
- Confluence page access for the account used in the dedicated browser.
- One browser backend:
  - `native`: a Chromium-compatible browser on Linux/macOS; or
  - `windows-wsl`: Windows Chrome/Edge plus WSL PowerShell interoperability and localhost connectivity.

Native check:

```bash
node --version
which google-chrome || which chromium || which brave-browser || which microsoft-edge
```

WSL check:

```bash
powershell.exe -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
wslinfo --networking-mode
```

## Cloud, Server/Data Center, and context paths

### Cloud

```bash
confluence-browser-fetch \
  'https://example.atlassian.net/wiki/spaces/ABC/pages/123456/Page+Title' \
  --raw-dir ./raw
```

The fetcher infers:

```text
origin:       https://example.atlassian.net
context path: /wiki
REST API:     https://example.atlassian.net/wiki/rest/api
```

### Server/Data Center at the root

```bash
confluence-browser-fetch \
  'https://confluence.example.com/pages/releaseview.action?pageId=123456' \
  --raw-dir ./raw
```

Inferred:

```text
origin:       https://confluence.example.com
context path: /
REST API:     https://confluence.example.com/rest/api
```

### Custom context

```bash
confluence-browser-fetch 123456 \
  --site https://intranet.example.com \
  --context-path /confluence \
  --raw-dir ./raw
```

Never mix page URLs from multiple origins in one invocation. The fetcher rejects them before browser launch.

## Browser backends

### Automatic selection

```bash
confluence-browser-fetch '<URL>' --browser-backend auto --raw-dir ./raw
```

`auto` selects:

- `windows-wsl` when running under WSL and `powershell.exe` is available;
- otherwise `native`.

### Native

```bash
confluence-browser-fetch '<URL>' --browser-backend native --raw-dir ./raw
```

Default profile and port:

```text
~/.local/share/atlassian-browser-chrome
9223
```

Set `CHROME=/path/to/browser` for nonstandard installations.

### Windows Chrome/Edge from WSL

```bash
confluence-browser-fetch '<URL>' \
  --browser-backend windows-wsl \
  --browser chrome \
  --raw-dir ./raw
```

Default Windows profile:

```text
%LOCALAPPDATA%\AgentSkillsBrowserProfiles\Atlassian
```

The PowerShell launcher:

- binds CDP to Windows `127.0.0.1`;
- creates a dedicated marked profile;
- refuses a non-empty unmarked profile;
- verifies browser, profile, and DevTools-port ownership before reuse or stop;
- disables browser sync in the dedicated profile.

`--profile-dir` must be a Windows path for this backend:

```bash
--profile-dir 'C:\Users\me\AppData\Local\AgentSkillsBrowserProfiles\Work'
```

Do not point it at an everyday browser profile.

## Common acquisition commands

One page:

```bash
confluence-browser-fetch '<URL>' --raw-dir ./raw
```

First privacy-conscious probe without attachments:

```bash
confluence-browser-fetch '<URL>' --no-attachments --raw-dir ./raw
```

Page and immediate children only:

```bash
confluence-browser-fetch '<URL>' --children --raw-dir ./raw
```

`--children` expands only user-supplied page/CQL seeds. Pages added as children are not expanded again.

Page and all descendants:

```bash
confluence-browser-fetch '<URL>' --descendants --raw-dir ./raw
```

`--children` and `--descendants` are mutually exclusive.

Exact title in a space:

```bash
confluence-browser-fetch \
  --site https://example.atlassian.net \
  --space ABC \
  --title 'Architecture Overview' \
  --raw-dir ./raw
```

CQL:

```bash
confluence-browser-fetch \
  --site https://example.atlassian.net \
  --cql 'space = ABC and type = page and text ~ "billing"' \
  --max-search-results 50 \
  --raw-dir ./raw
```

Force refresh:

```bash
confluence-browser-fetch '<URL>' --force --raw-dir ./raw
```

By default, matching page ID, status, version number, and version timestamp are skipped.

## Attachments

The default maximum is `5mb`:

```bash
--max-attachment-size 10mb
```

Attachment metadata is listed before download. Files whose declared size exceeds the configured maximum are skipped. Files without a trustworthy declared size are streamed in the browser and cancelled once the bound is exceeded.

A hard browser-transfer safety cap defaults to `100mb`, including when the legacy `unlimited` value is requested. Operators may lower or deliberately raise it:

```bash
export CONFLUENCE_BROWSER_MAX_BINARY_SIZE=25mb
```

Avoid `unlimited` for routine agent ingestion.

## Environment variables

| Variable | Meaning |
|---|---|
| `CONFLUENCE_SITE` | Default origin/application URL |
| `CONFLUENCE_CONTEXT_PATH` | `auto`, `/wiki`, `/`, or custom context |
| `CONFLUENCE_RAW_DIR` | Output directory |
| `CONFLUENCE_BROWSER_BACKEND` | `auto`, `native`, or `windows-wsl` |
| `CONFLUENCE_BROWSER` | `chrome` or `edge` for Windows/WSL |
| `CONFLUENCE_CHROME_DEBUG_PORT` | DevTools port; overrides shared variable |
| `ATLASSIAN_CHROME_DEBUG_PORT` | Shared DevTools port, default `9223` |
| `CONFLUENCE_CHROME_PROFILE` | Dedicated profile; backend-native path syntax |
| `ATLASSIAN_CHROME_PROFILE` | Shared native profile override |
| `CONFLUENCE_FETCH_WAIT_SEC` | SSO wait, default `900` |
| `CONFLUENCE_MAX_SEARCH_RESULTS` | CQL result bound, default `200` |
| `CONFLUENCE_MAX_ATTACHMENT_SIZE` | Attachment bound, default `5mb` |
| `CONFLUENCE_BROWSER_MAX_BINARY_SIZE` | Hard transfer cap, default `100mb` |
| `CONFLUENCE_RETRIES` | Transient retry count, default `3` |
| `CONFLUENCE_REQUEST_TIMEOUT_SEC` | Request timeout, default `60` |
| `CONFLUENCE_SKIP_UNCHANGED` | Set to `0` to disable version skip |
| `CHROME` / `CHROMIUM` | Native browser executable override |

## Output files

Per page:

- `page.json` — REST content with storage/view bodies, space, ancestors, labels, version, and history.
- `page.storage.html` — Confluence storage XHTML.
- `page.view.html` — REST-rendered body.
- `page.browser.html` — authenticated web response, unless disabled.
- `attachments.json` — downloaded/skipped/error manifest.
- `attachments/` — bounded downloads.
- `metadata.json` — provenance, deployment, version, and transport metadata.

Run manifest:

```text
raw/confluence-browser-fetch-run.json
```

## Troubleshooting

### Waiting for SSO to return to the configured origin

Finish authentication in the dedicated browser. During Microsoft/SAML redirects no target at the Confluence origin may exist; the fetcher waits for it to return rather than inspecting the identity-provider page.

### Session probes return 404

The context path is probably wrong. Try one of:

```bash
--context-path /
--context-path /wiki
--context-path /confluence
```

Classic `/pages/viewpage.action` and `/pages/releaseview.action` URLs normally imply `/` unless prefixed.

### Browser request failed / cross-origin redirect

The session may be expired and REST calls are redirecting to SSO. Authenticate in the dedicated browser and retry. Cross-origin response bodies are deliberately unavailable.

### No browser found in WSL

Use the Windows backend rather than attempting to launch a Windows `.exe` as a native Linux browser:

```bash
--browser-backend windows-wsl
```

### DevTools endpoint does not start

1. Confirm Windows Chrome/Edge exists.
2. Confirm the selected port is free.
3. Confirm WSL can reach Windows loopback.
4. Do not expose CDP through firewall or LAN changes.
5. Try another loopback port, for example `--port 9334`.

### Dedicated profile refusal

The launcher refuses non-empty profiles without its marker. Choose a new empty path. Do not bypass this by adding a marker to an everyday profile.

### Page HTTP 401/403/404

- `401`: session not authenticated.
- `403`: the browser account lacks permission.
- `404`: page ID, site, context path, or permission may be wrong.

## Confidentiality

Never paste or commit:

- cookies or session headers;
- SAML request/response values;
- identity-provider URLs containing transient state;
- private page exports, attachments, or run manifests;
- dedicated browser profiles.
