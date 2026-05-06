# Confluence Browser Fetch Usage

## Why Browser Fetch?

Confluence Cloud pages are often behind Microsoft/SSO. API-token Basic auth may be disabled or inconvenient. Browser fetch works by:

1. Launching Chrome with a dedicated user profile.
2. Letting the user complete normal SSO.
3. Reading Atlassian cookies through local Chrome DevTools.
4. Calling Confluence REST endpoints with those cookies.

No cookie or API token needs to be pasted into chat.

## Requirements

- Node.js 22+.
- Google Chrome or Chromium.
- Access to the Confluence page with the logged-in account.

Check:

```bash
node --version
which google-chrome || which chromium || which chromium-browser
```

If Chrome has a different path:

```bash
CHROME=/path/to/chrome scripts/confluence-browser-fetch.js 123456
```

## Common Commands

Fetch one page by URL:

```bash
scripts/confluence-browser-fetch.js \
  'https://example.atlassian.net/wiki/spaces/ABC/pages/123456/Page+Title' \
  --site https://example.atlassian.net \
  --raw-dir /path/to/wiki/raw
```

Fetch one page by page ID:

```bash
scripts/confluence-browser-fetch.js 123456 \
  --site https://example.atlassian.net \
  --raw-dir /path/to/wiki/raw
```

Fetch a page and descendants:

```bash
scripts/confluence-browser-fetch.js 123456 \
  --site https://example.atlassian.net \
  --raw-dir /path/to/wiki/raw \
  --descendants
```

Fetch by exact title in a space:

```bash
scripts/confluence-browser-fetch.js \
  --site https://example.atlassian.net \
  --raw-dir /path/to/wiki/raw \
  --space ABC \
  --title 'Architecture Overview'
```

Fetch by CQL:

```bash
scripts/confluence-browser-fetch.js \
  --site https://example.atlassian.net \
  --raw-dir /path/to/wiki/raw \
  --cql 'space = ABC and type = page and text ~ "invoice"'
```

Use shorter wait when already logged in:

```bash
CONFLUENCE_FETCH_WAIT_SEC=15 scripts/confluence-browser-fetch.js 123456 --raw-dir ./raw
```

Re-fetch everything even when versions match:

```bash
scripts/confluence-browser-fetch.js 123456 --descendants --force --raw-dir ./raw
```

Skip attachment downloads above a threshold while still recording references in `attachments.json`:

```bash
scripts/confluence-browser-fetch.js 123456 --descendants --raw-dir ./raw --max-attachment-size 10mb
```

Default max attachment download size is `5mb`. Use `--max-attachment-size unlimited` to download all attachments.

By default, pages with matching local `metadata.json` Confluence `version.number` and `version.when` are skipped. This avoids re-downloading unchanged page HTML and attachments during large tree fetches.

## Environment Variables

| Variable | Meaning |
|---|---|
| `CONFLUENCE_SITE` | Default Atlassian site, e.g. `https://example.atlassian.net` |
| `CONFLUENCE_RAW_DIR` | Default output raw directory |
| `CONFLUENCE_CHROME_DEBUG_PORT` | Chrome DevTools port, default `9224` |
| `CONFLUENCE_FETCH_WAIT_SEC` | Wait timeout, default `900` |
| `CONFLUENCE_MAX_SEARCH_RESULTS` | Max CQL pages, default `200` |
| `CONFLUENCE_MAX_ATTACHMENT_SIZE` / `CONFLUENCE_MAX_ATTACHMENT_BYTES` | Max attachment download size, default `5mb`; skipped files are listed in `attachments.json` |
| `CONFLUENCE_RETRIES` | Retry count for transient HTTP errors, default `3` |
| `CONFLUENCE_REQUEST_TIMEOUT_SEC` | Per-request timeout, default `60` |
| `CONFLUENCE_SKIP_UNCHANGED` | Set to `0` to disable default skip-unchanged behavior |
| `CONFLUENCE_CHROME_PROFILE` | Dedicated Chrome profile dir |
| `CHROME` | Chrome executable path |

## Output Files

For each page:

- `page.json` — REST content with body.storage, body.view, space, ancestors, labels, version, history.
- `page.storage.html` — Confluence storage XHTML.
- `page.view.html` — REST-rendered HTML body.
- `page.browser.html` — full browser HTML shell/page.
- `attachments.json` — manifest, including skipped large-file references with URL, file size, and reason.
- `attachments/` — files downloaded via Confluence attachment links under the max-size threshold.
- `metadata.json` — fetch metadata and source URLs.

## Troubleshooting

### `no Atlassian cookies yet`

Complete SSO in the Chrome window opened by the script.

### `Page failed HTTP 404`

The authenticated user cannot see the page, or the page ID/site is wrong.

### URL cannot be resolved

Provide the numeric page ID from a URL like:

```text
/wiki/spaces/ABC/pages/123456/Page+Title
/wiki/pages/viewpage.action?pageId=123456
```

Tiny links may not expose the page ID; open them in the browser and copy the expanded URL.

### CQL returns too many pages

Use `--max-search-results N` or a narrower query.

### DevTools port already in use

Use another port:

```bash
scripts/confluence-browser-fetch.js 123456 --port 9334
```
