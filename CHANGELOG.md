# Changelog

## Unreleased

(empty)

## 0.10.0 - 2026-05-08

Added:

- New `jira-update` skill for dry-run-first Jira Cloud writes through an authenticated browser session: `create`, `comment`, `transition`, `update-fields`, and `link` commands. Markdown-to-ADF conversion by default; ADF passthrough as escape hatch.

Changed:

- Extracted browser/CDP/cookie helpers from all four existing skills into a single source-of-truth `lib/atlassian-browser.js`. Vendored at pack time into each `skills/*/scripts/atlassian-browser.js` so each skill folder remains self-contained on disk. Eliminates ~870 lines of duplicated code across the bundle.

## 0.9.0 - 2026-05-07

Added:

- New `bitbucket-browser-fetch` skill for browser-authenticated Bitbucket Cloud project repository inventory, SSH/HTTPS clone URL lists, Markdown summaries, and safe clone helper scripts.

## 0.8.0 - 2026-05-07

Added:

- `confluence-update` now supports `--labels "a,b,c"` to assign Confluence page labels during an update.
- `confluence-update` now supports `--wrap-macro NAME` (e.g., `page-properties`) to automatically wrap the output HTML in a Confluence `<ac:structured-macro>` element.

## 0.7.0 - 2026-05-07

Added:

- New `confluence-update` skill for dry-run-first Confluence page updates, agent-owned block replacement, simple Markdown-to-storage conversion, and page creation through authenticated browser sessions.

## 0.6.1 - 2026-05-07

Fixed:

- Browser fetchers no longer open duplicate target tabs when reusing DevTools during bulk Jira/Confluence runs.

## 0.6.0 - 2026-05-07

Added:

- Shared `ATLASSIAN_CHROME_PROFILE` and `ATLASSIAN_CHROME_DEBUG_PORT` support so Jira and Confluence fetchers can reuse one dedicated Atlassian SSO browser session.
- Browser fetchers now open the requested target URL in a new tab when reusing an existing DevTools browser.

## 0.5.0 - 2026-05-07

Added:

- `confluence-browser-fetch` now verifies an authenticated Confluence REST session before fetching pages, avoiding false positives from Atlassian login-page cookies.
- `jira-browser-fetch` now verifies an authenticated Jira REST session before issue, JQL, or backlog fetches, avoiding false positives from Atlassian login-page cookies.
- `jira-browser-fetch --backlog URL|BOARD_ID` to fetch all issues from a Jira Software board backlog through the authenticated browser session.
- Backlog manifests at `raw/jira-board-<board-id>-backlog.json` and a `backlogs` section in `raw/jira-browser-fetch-run.json`.
- Documentation examples for natural-language user requests that should invoke the skills.
- Recommended `npx skills add aholbreich/agent-skills -g` cross-agent install path, plus collision/update guidance for Pi and project-local overrides.
- CI/package dry-run scripts that use `npm pack --dry-run` for compatibility with older local pnpm launchers.
- `agent-skills install --skill NAME` and `--pick` to install only selected bundled skills from the fallback npx installer.
- Browser fetchers now auto-detect common Chromium-compatible browsers (Chrome, Chromium, Brave, Edge, Vivaldi) instead of only trying `/usr/bin/google-chrome` unless `CHROME` is set.

## 0.1.0 - 2026-05-06

Initial public package structure.

Added:

- `jira-browser-fetch` skill for browser-authenticated Jira issue/JQL/linked-ticket fetches.
- `confluence-browser-fetch` skill for browser-authenticated Confluence page/CQL/descendant fetches.
- Default 5 MiB attachment download cap with skipped-file references in `attachments.json`.
- Confluence skip-unchanged behavior based on page version metadata.
- Retry and timeout options for Confluence fetches.
- Pi package metadata, README, security policy, and CI syntax checks.
- Node built-in unit tests for helper logic and CLI smoke/error paths.
- `agent-skills` installer CLI for `npx @aholbreich/agent-skills` one-shot installs.
- Default npx target is the generic Agent Skills location `~/.agents/skills`.
