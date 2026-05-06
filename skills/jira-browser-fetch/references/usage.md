# Jira Browser Fetch Usage

## Why Browser Fetch?

Some Jira Cloud organizations use Microsoft/SSO and block or break API-token Basic auth. The browser fetcher avoids this by:

1. Launching Chrome with a dedicated user profile.
2. Letting the user complete normal SSO in Chrome.
3. Reading Jira cookies through the local Chrome DevTools protocol.
4. Calling Jira REST endpoints with those cookies.

No token or cookie needs to be pasted into chat.

## Requirements

- Linux/macOS with Chrome or Chromium.
- Node.js 22+.
- Network access to the Jira site.

Check:

```bash
node --version
which google-chrome || which chromium || which chromium-browser
```

If Chrome has a different path:

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
| `JIRA_MAX_SEARCH_RESULTS` | Max issues added per JQL search, default `1000` |
| `JIRA_MAX_ATTACHMENT_SIZE` / `JIRA_MAX_ATTACHMENT_BYTES` | Max attachment download size, default `5mb`; skipped files are listed in `attachments.json` |
| `JIRA_CHROME_PROFILE` | Dedicated Chrome profile dir |
| `CHROME` | Chrome executable path |

## Troubleshooting

### `no Jira cookies yet`

Complete SSO in the Chrome window opened by the script.

### `HTTP 404 Issue does not exist or you do not have permission`

The session works, but the account cannot see the issue or the key is not a Jira issue.

### Chrome does not open

Set the executable path:

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
