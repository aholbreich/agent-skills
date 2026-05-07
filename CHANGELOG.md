# Changelog

## Unreleased

Added:

- `confluence-browser-fetch` now verifies an authenticated Confluence REST session before fetching pages, avoiding false positives from Atlassian login-page cookies.
- `jira-browser-fetch --backlog URL|BOARD_ID` to fetch all issues from a Jira Software board backlog through the authenticated browser session.
- Backlog manifests at `raw/jira-board-<board-id>-backlog.json` and a `backlogs` section in `raw/jira-browser-fetch-run.json`.
- Documentation examples for natural-language user requests that should invoke the skills.
- Recommended `npx skills add aholbreich/agent-skills -g` cross-agent install path, plus collision/update guidance for Pi and project-local overrides.
- CI/package dry-run scripts that use `npm pack --dry-run` for compatibility with older local pnpm launchers.
- `agent-skills install --skill NAME` and `--pick` to install only selected bundled skills from the fallback npx installer.

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
