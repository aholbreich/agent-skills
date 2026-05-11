# Changelog

## 1.1.0 - 2026-05-11

Added:

- `jira-browser-fetch --skip-existing` skips issues that already have a valid `raw/<KEY>/issue.json`, reading the saved `connected-keys.json` so `--connected --scan-text` traversal still resumes correctly.
- `jira-browser-fetch` prints aggregate progress (`[N/total] pct%`) and a trailing ETA line during multi-issue runs.
- `confluence-update` and `confluence-browser-fetch` emit a clearer error when Confluence probes return 404. After all wikiBase probes 404, the verifier does one sanity probe against the Jira API at the same site root; if that succeeds, the error specifically says "cookies are valid for ${site} but Confluence at ${wikiBase} returned 404", pointing to either a wrong `--site` or a tenant without Confluence enabled.
- README gains a "Project status" section flagging the opinionated browser-only auth approach, Linux-Fedora-only end-to-end testing, and a feedback request.
- Every SKILL.md's "Shared Atlassian SSO Session" section now teaches calling agents three things: (i) the script-Chrome is a separate window from the user's regular browser, cookies from the user's Chrome are not read; (ii) reuse signal — `Reusing Chrome DevTools on port 9223` / `Found existing tab for <host>` means do not re-prompt SSO; (iii) `CHROME=/path/to/launcher` env var for Flatpak/Snap/non-PATH installs. The Typical Workflow's SSO step is clarified to be first-run-or-expired-only.

Changed:

- The "Reuse one Atlassian browser login" section in README now reflects the unified-defaults behavior — no env vars required for the default sharing.
- **Unified Chrome profile and DevTools port across all five Atlassian skills.** Defaults are now `~/.local/share/atlassian-browser-chrome` and port `9223` for `jira-browser-fetch`, `jira-update`, `confluence-browser-fetch`, `confluence-update`, and `bitbucket-browser-fetch`. One SSO login persists across all skills — no env vars required. Skill-specific `*_CHROME_PROFILE` / `*_CHROME_DEBUG_PORT` env vars still override for isolation. Each SKILL.md gains a "Shared Atlassian SSO Session" section near the top.
- `confluence-update` and `confluence-browser-fetch` now strip a trailing `/wiki` from `--site` (or `CONFLUENCE_SITE`) with a stderr note, instead of building the unreachable `…/wiki/wiki` URL.
- Replaced the 19-step `npm run check` chain with a `bin/check.js` script that auto-discovers `bin/`, `lib/`, and every `skills/*/scripts/` JS file. Aggregates failures (no longer stops at the first error) and prints a summary line. New skills/scripts are picked up automatically with no `package.json` edit.

Migration:

- Users who previously logged in via the old per-skill profiles (`~/.local/share/jira-browser-fetch-chrome`, `confluence-browser-fetch-chrome`, `bitbucket-browser-fetch-chrome`) will hit a fresh login on first run after upgrade. To preserve the existing session, move whichever profile you used: `mv ~/.local/share/jira-browser-fetch-chrome ~/.local/share/atlassian-browser-chrome` (only one — pick the one with your live cookies). Or just re-SSO once; the new shared profile then serves all five skills.

## 1.0.1 - 2026-05-09

Added:

- `jira-update <command> --help` and `confluence-update <command> --help` now print command-specific options instead of falling back to top-level usage.
- `jira-update transition --help` documents the `--field key=value` heuristics (`priority`/`resolution`/`status` wrap as `{name: VALUE}`; `labels`/`components`/`fixVersions` split on commas; everything else passes through as a string).
- `jira-update` validates issue keys client-side (`PROJ-123` form). `comment`, `transition`, `update-fields`, `link <FROM>`, and `link --to <TO>` fail fast with exit 2 instead of round-tripping a bad key through SSO and the Jira REST API.

Changed:

- `jira-update` validation errors (missing manifest fields, unresolved transitions/link types, bad representation) now exit 2 with a clean `error: ...` message instead of dumping a Node stack trace and exiting 1. Implemented via a new `UsageError` class in `skills/jira-update/scripts/lib.js`.

## 1.0.0 - 2026-05-08

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
