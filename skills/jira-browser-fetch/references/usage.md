# Jira Browser Fetch Usage

## Why Browser Fetch?

Some Jira Cloud organizations use Microsoft/SSO and block or break API-token Basic auth. The browser fetcher avoids this by:

1. Launching Chrome with a dedicated user profile.
2. Letting the user complete normal SSO in Chrome.
3. Reading Jira cookies through the local Chrome DevTools protocol.
4. Verifying those cookies represent an authenticated Jira REST session.
5. Calling Jira REST endpoints with those cookies.

No token or cookie needs to be pasted into chat.

## Requirements

- Linux/macOS with a Chromium-compatible browser: Chrome, Chromium, Brave, Edge, or Vivaldi.
- Node.js 22+.
- Network access to the Jira site.

Check:

```bash
node --version
which google-chrome || which chromium || which chromium-browser || which brave-browser || which microsoft-edge
```

The script auto-detects common Chromium-compatible browsers. If yours has a different path:

```bash
CHROME=/path/to/chrome scripts/jira-browser-fetch.js PROJ-123
```

## Common Commands

Fetch one issue:

```bash
scripts/jira-browser-fetch.js PROJ-123 \
  --server https://example.atlassian.net \
  --raw-dir /path/to/wiki/raw
```

Fetch one issue and formal Jira links/subtasks/parents:

```bash
scripts/jira-browser-fetch.js PROJ-123 \
  --server https://example.atlassian.net \
  --raw-dir /path/to/wiki/raw \
  --connected \
  --depth 1
```

Fetch issue keys mentioned in comments/descriptions/rendered HTML too:

```bash
scripts/jira-browser-fetch.js PROJ-123 \
  --server https://example.atlassian.net \
  --raw-dir /path/to/wiki/raw \
  --connected \
  --scan-text \
  --prefix PROJ,HELPDESK \
  --depth 1
```

Fetch all issues assigned to the current browser-authenticated Jira user:

```bash
scripts/jira-browser-fetch.js \
  --server https://example.atlassian.net \
  --raw-dir /path/to/wiki/raw \
  --assignee-me
```

Fetch any JQL result set:

```bash
scripts/jira-browser-fetch.js \
  --server https://example.atlassian.net \
  --raw-dir /path/to/wiki/raw \
  --jql "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC"
```

Fetch every issue currently visible in a Jira Software board backlog:

```bash
scripts/jira-browser-fetch.js \
  --server https://example.atlassian.net \
  --raw-dir /path/to/wiki/raw \
  --backlog 'https://example.atlassian.net/jira/software/c/projects/ABC/boards/42/backlog?epics=visible'
```

If you already know the board id, this is equivalent:

```bash
scripts/jira-browser-fetch.js \
  --server https://example.atlassian.net \
  --raw-dir /path/to/wiki/raw \
  --backlog 42
```

A backlog fetch writes `raw/jira-board-<board-id>-backlog.json` with the ordered backlog issue keys and adds a `backlogs` section to `raw/jira-browser-fetch-run.json`.

Use a shorter wait when the browser session is already logged in:

```bash
JIRA_FETCH_WAIT_SEC=15 scripts/jira-browser-fetch.js PROJ-123 --raw-dir ./raw
```

Skip attachment downloads above a threshold while still recording references in `attachments.json`:

```bash
scripts/jira-browser-fetch.js PROJ-123 --raw-dir ./raw --max-attachment-size 10mb
```

Default max attachment download size is `5mb`. Use `--max-attachment-size unlimited` to download all attachments.

## Environment Variables

| Variable | Meaning |
|---|---|
| `JIRA_SERVER` | Default Jira base URL |
| `JIRA_RAW_DIR` | Default output raw directory |
| `JIRA_CHROME_DEBUG_PORT` | Chrome DevTools port, default `9223` |
| `JIRA_FETCH_WAIT_SEC` | Wait timeout per issue, default `900` |
| `JIRA_MAX_SEARCH_RESULTS` | Max issues added per JQL or backlog search, default `1000` |
| `JIRA_MAX_ATTACHMENT_SIZE` / `JIRA_MAX_ATTACHMENT_BYTES` | Max attachment download size, default `5mb`; skipped files are listed in `attachments.json` |
| `JIRA_CHROME_PROFILE` | Dedicated Chrome profile dir |
| `CHROME` / `CHROMIUM` | Browser executable path override |

## Example user requests

Agents should invoke this skill for requests such as:

- "Fetch all Jira issues from this backlog URL into `/raw`."
- "Archive board 42's Jira backlog for my LLM wiki."
- "Fetch my assigned Jira issues through the browser because API tokens do not work."
- "Fetch `PROJ-123` and all connected tickets with attachments."
- "Use this JQL and store the raw Jira evidence under the wiki raw folder."

## Troubleshooting

### `no Atlassian cookies yet` / `not authenticated yet`

Complete SSO in the Chrome window opened by the script. Login-page cookies are not enough; the script waits until a Jira REST session probe succeeds.

### `Could not verify authenticated Jira session`

The browser did not reach an authenticated Jira REST session before `--wait` expired. Complete SSO, confirm you can open the target Jira site in that browser profile, then rerun or increase `--wait`.

### `HTTP 404 Issue does not exist or you do not have permission`

The session works, but the account cannot see the issue or the key is not a Jira issue.

### Browser does not open

The script tries `CHROME`, `CHROMIUM`, then common Chrome/Chromium/Brave/Edge/Vivaldi executable names and macOS app paths. If auto-detection fails, set the executable path:

```bash
CHROME=/usr/bin/chromium scripts/jira-browser-fetch.js PROJ-123
```

### DevTools port already in use

Use another port:

```bash
scripts/jira-browser-fetch.js PROJ-123 --port 9333
```

### SSO opens in the wrong Chrome profile

The script uses its own profile by default. That is intentional so it can enable remote debugging safely. Complete SSO once in that window; future runs reuse it.
