# Confluence Update Usage

## Why Browser Update?

Some Confluence Cloud organizations use Microsoft/SSO and make API-token auth difficult. This updater avoids pasted secrets by:

1. Launching/reusing a dedicated Chromium-compatible browser profile.
2. Letting the user complete normal Atlassian SSO in the browser.
3. Reading Atlassian cookies through local Chrome DevTools.
4. Verifying those cookies represent an authenticated Confluence REST session.
5. Writing through Confluence REST only after `--apply`.

## Safety Model

Dry-run is the default. Without `--apply`, the script writes audit/proposal files locally but does not update Confluence.

Always review:

- `proposed.storage.html`
- `payload.json`
- `update-run.json`

For existing pages, the script also stores `before.page.json` and `before.storage.html`.

## Common Commands

Dry-run full-page update with native Confluence storage XHTML:

```bash
scripts/confluence-update.js update 123456 \
  --site https://example.atlassian.net \
  --file ./page.storage.html
```

Apply after review:

```bash
scripts/confluence-update.js update 123456 \
  --site https://example.atlassian.net \
  --file ./page.storage.html \
  --expected-version 17 \
  --message 'Update architecture notes' \
  --apply
```

Replace an agent-owned block from Markdown:

```bash
scripts/confluence-update.js replace-block 123456 \
  --site https://example.atlassian.net \
  --marker agent-summary \
  --file ./summary.md \
  --representation markdown
```

Create a page from Markdown:

```bash
scripts/confluence-update.js create \
  --site https://example.atlassian.net \
  --space ABC \
  --parent-id 123456 \
  --title 'Architecture Notes' \
  --file ./page.md \
  --representation markdown
```

## Agent-owned Blocks

Use block replacement for LLM-generated content. It protects human-written parts of the page.

Page storage must contain markers:

```html
<!-- agent-block:release-notes:start -->
<p>Old generated content.</p>
<!-- agent-block:release-notes:end -->
```

Then update only that region:

```bash
scripts/confluence-update.js replace-block 123456 \
  --marker release-notes \
  --file ./release-notes.md \
  --representation markdown
```

If the marker is missing, the command fails. It does not insert content into an unmarked page.

## Representations

| Representation | Meaning |
|---|---|
| `storage` | Native Confluence storage XHTML. Best for exact page updates and preserving advanced Confluence structures. |
| `markdown` | Small built-in Markdown subset converted to storage XHTML. Best for agent-owned blocks and simple new pages. |

The Markdown converter is intentionally simple: headings, paragraphs, unordered/ordered lists, links, emphasis, inline code, and fenced code blocks. For complex macros/layouts, use `storage`.

## Environment Variables

| Variable | Meaning |
|---|---|
| `CONFLUENCE_SITE` | Default Atlassian site, e.g. `https://example.atlassian.net` |
| `CONFLUENCE_UPDATE_RAW_DIR` / `CONFLUENCE_RAW_DIR` | Audit/output raw directory |
| `CONFLUENCE_CHROME_DEBUG_PORT` | Chrome DevTools port, default `9223`; overrides `ATLASSIAN_CHROME_DEBUG_PORT` |
| `ATLASSIAN_CHROME_DEBUG_PORT` | Shared Chrome DevTools port for all Atlassian browser skills (Jira/Confluence/Bitbucket). Default `9223`. |
| `CONFLUENCE_UPDATE_WAIT_SEC` / `CONFLUENCE_FETCH_WAIT_SEC` | Wait timeout, default `900` |
| `CONFLUENCE_CHROME_PROFILE` | Dedicated Chrome profile dir; overrides `ATLASSIAN_CHROME_PROFILE`. By default this uses the same profile as `confluence-browser-fetch`. |
| `ATLASSIAN_CHROME_PROFILE` | Shared browser profile dir for Jira, Confluence fetch, and Confluence update tools |
| `CHROME` / `CHROMIUM` | Browser executable path override |

## Shared Atlassian SSO Session

To reuse one Atlassian browser login across Jira fetch, Confluence fetch, and Confluence update:

```bash
export ATLASSIAN_CHROME_PROFILE="$HOME/.local/share/atlassian-browser-fetch-chrome"
export ATLASSIAN_CHROME_DEBUG_PORT=9223
```

## Troubleshooting

### Dry-run did not update the page

That is expected. Add `--apply` only after reviewing the audit files.

### Version mismatch

The page changed after the agent prepared the update. Refetch/review the page and rerun with the new version.

### Marker block not found

`replace-block` only edits explicitly marked regions. Add the marker block manually or use full-page `update` after review.

### Authentication waits forever

Complete SSO in the opened browser. Login-page cookies are not enough; the script waits until a Confluence REST probe succeeds.
