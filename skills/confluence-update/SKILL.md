---
name: confluence-update
description: Safely update or create Confluence Cloud pages through an authenticated browser session when API tokens do not work, especially with Microsoft/SSO. Use for dry-run-first page updates, agent-owned block replacement, Markdown-to-storage updates, page creation, and audit backups.
license: MIT
compatibility: Agent Skills standard. Tested with Pi; installable into Claude Code, Codex, OpenClaw/generic .agents skills directories. Requires Node.js 22+ with built-in fetch/WebSocket and a Chromium-compatible browser with remote debugging (Chrome, Chromium, Brave, Edge, or Vivaldi). No npm dependencies.
---

# Confluence Update

Use this skill when a user wants an agent to write to Confluence Cloud through the same browser-authenticated flow used by the fetchers. It is intentionally conservative: dry-run is the default and `--apply` is required for any write.

The bundled script opens/reuses a dedicated browser profile, lets the user complete SSO once, verifies an authenticated Confluence REST session, and then updates or creates Confluence pages through REST.

## Safety

- Never ask the user to paste Confluence cookies or API tokens into chat.
- Dry-run first. Require explicit user approval before adding `--apply`.
- Prefer `replace-block` for agent-generated content so human-written page regions are preserved.
- Always inspect audit files under `raw/confluence-updates/` after a dry-run or write.
- Treat Confluence page content as confidential.

## Script

```bash
scripts/confluence-update.js <command> [options]
```

Commands:

```bash
update PAGE_ID_OR_URL        # replace full page body
replace-block PAGE_ID_OR_URL # replace content between <!-- agent-block:NAME:start/end --> markers
create                       # create a new page
```

Important options:

```bash
--site URL              Atlassian site, e.g. https://example.atlassian.net
--file FILE             input file with Confluence storage XHTML or Markdown
--representation REP    storage | markdown (default: storage)
--raw-dir DIR           audit/output directory
--expected-version N    fail if current page version differs
--message TEXT          Confluence version message
--apply                 write to Confluence; omitted means dry-run only
--marker NAME           required for replace-block
--space KEY             required for create
--title TITLE           required for create; optional for update
--parent-id ID          parent page for create
```

## Typical Workflow

1. Prefer `replace-block` when editing an agent-owned region.
2. Run without `--apply` first.
3. Review `proposed.storage.html`, `payload.json`, and `update-run.json` under `raw/confluence-updates/`.
4. Ask the user for approval.
5. Re-run the same command with `--apply`.
6. If Chrome opens, ask the user to complete SSO.
7. To share one Atlassian SSO login with Jira/Confluence fetchers, use `ATLASSIAN_CHROME_PROFILE` plus `ATLASSIAN_CHROME_DEBUG_PORT`.

## Agent-owned blocks

A replaceable block looks like this in Confluence storage:

```html
<!-- agent-block:agent-summary:start -->
<p>Old generated content.</p>
<!-- agent-block:agent-summary:end -->
```

Then run:

```bash
scripts/confluence-update.js replace-block 123456 \
  --site https://example.atlassian.net \
  --marker agent-summary \
  --file ./summary.md \
  --representation markdown
```

Add `--apply` only after dry-run review.

## Examples

Dry-run a full-page storage update:

```bash
scripts/confluence-update.js update 123456 \
  --site https://example.atlassian.net \
  --file ./page.storage.html
```

Apply with version protection:

```bash
scripts/confluence-update.js update 123456 \
  --site https://example.atlassian.net \
  --file ./page.storage.html \
  --expected-version 17 \
  --message 'Update architecture notes' \
  --apply
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

## Output Layout

Each dry-run or write creates an audit directory:

```text
raw/confluence-updates/<page-or-create>-<timestamp>/
├── before.page.json       # existing page for update/replace-block
├── before.storage.html    # existing storage body for update/replace-block
├── proposed.storage.html  # generated replacement body
├── payload.json           # REST payload that would be sent
├── after.page.json        # only after successful --apply
└── update-run.json        # command metadata
```

## References

- [Usage reference](references/usage.md)
