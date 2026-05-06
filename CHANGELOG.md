# Changelog

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
