---
name: jira-update
description: Safely create or update Jira Cloud issues through an authenticated browser session when API tokens do not work, especially with Microsoft/SSO. Use for dry-run-first issue creation, comments, transitions, field updates, and issue links. Markdown-to-ADF conversion by default; ADF passthrough as escape hatch.
license: MIT
compatibility: Agent Skills standard. Tested with Pi; installable into Claude Code, Codex, OpenClaw/generic .agents skills directories. Requires Node.js 22+ with built-in fetch/WebSocket and a Chromium-compatible browser with remote debugging (Chrome, Chromium, Brave, Edge, or Vivaldi). No npm dependencies.
---

# Jira Update

Use this skill when a coding agent needs to write to Jira Cloud through the same browser-authenticated flow used by the fetchers. Dry-run is the default; `--apply` is required for any write.

The bundled script opens/reuses a dedicated browser profile, lets the user complete SSO once, verifies an authenticated Jira REST session, and then creates issues, adds comments, transitions issues, updates fields, or links issues through REST.

## Safety

- Never ask the user to paste Jira cookies or API tokens into chat.
- Dry-run first. Require explicit user approval before adding `--apply`.
- Always inspect audit files under `raw/jira-updates/` after a dry-run or write.
- `update-fields` does NOT detect concurrent edits. Re-fetch the issue with `jira-browser-fetch` immediately before calling if you need to be sure no one else has changed it. The audit dir always contains `before.issue.json` for forensic recovery.
- Treat issue content as confidential.

## Script

```bash
scripts/jira-update.js <command> [options]
```

Commands:

```bash
create                       # Create a new issue from a JSON manifest
comment ISSUE-KEY            # Add a comment
transition ISSUE-KEY         # Move through workflow
update-fields ISSUE-KEY      # Partial field update
link FROM-KEY                # Link two issues
```

Common options:

```bash
--server URL              Jira base URL (or set JIRA_SERVER), e.g. https://example.atlassian.net
--file FILE               Input file (JSON manifest for create/update-fields, Markdown/ADF for comment)
--representation REP      markdown | adf (default: markdown). Applies to comment.
--raw-dir DIR             Audit dir (default: ./raw)
--apply                   Actually write. Without this, only dry-run/audit files are written
--message TEXT            Annotate the local audit record (not sent to Jira)
--wait SEC                Wait time for SSO/session (default: 900)
--port PORT               Chrome DevTools port (default: ATLASSIAN_CHROME_DEBUG_PORT, or 9223)
--profile-dir DIR         Chrome profile dir
```

Command-specific options:

```bash
transition: --to NAME | --to-id ID, --comment-file FILE, --field key=value (repeatable)
link:       --to ISSUE-KEY, --type "blocks" | "relates" | etc.
```

## Shared Atlassian SSO Session

All five Atlassian skills (`jira-browser-fetch`, `jira-update`, `confluence-browser-fetch`, `confluence-update`, `bitbucket-browser-fetch`) default to the same Chrome profile (`~/.local/share/atlassian-browser-chrome`) and DevTools port (`9223`). Log in once via any skill and the others reuse that session automatically — no env vars needed.

Override with `ATLASSIAN_CHROME_PROFILE` and/or `ATLASSIAN_CHROME_DEBUG_PORT` to relocate the shared profile/port, or use skill-specific `*_CHROME_PROFILE` / `*_CHROME_DEBUG_PORT` env vars for isolation.

## Typical Workflow

1. Run without `--apply` first.
2. Review files in `raw/jira-updates/<command>-<key|new>-<timestamp>/`.
3. Ask the user for approval.
4. Re-run the same command with `--apply`.

## Examples

Dry-run an issue creation from a Markdown-rich manifest:

```bash
scripts/jira-update.js create \
  --server https://example.atlassian.net \
  --file ./new-bug.json
```

Apply after review:

```bash
scripts/jira-update.js create \
  --server https://example.atlassian.net \
  --file ./new-bug.json \
  --apply
```

Add a comment from Markdown:

```bash
scripts/jira-update.js comment PROJ-123 \
  --server https://example.atlassian.net \
  --file ./reply.md \
  --apply
```

Transition with a comment:

```bash
scripts/jira-update.js transition PROJ-123 \
  --server https://example.atlassian.net \
  --to "In Progress" \
  --comment-file ./status.md \
  --apply
```

## Output Layout

```text
raw/jira-updates/<command>-<key|new>-<timestamp>/
├── before.issue.json         # existing issue for comment/transition/update-fields/link
├── proposed.payload.json     # exact REST body that would be sent
├── proposed.adf.json         # rendered ADF if Markdown conversion happened
├── transitions.json          # transition: snapshot of available transitions
├── linktypes.json            # link: resolved link-type record
├── after.issue.json          # post-apply only
└── update-run.json           # command metadata
```

## References

- [Usage reference](references/usage.md)
- [Distribution guide](references/distribution.md)
