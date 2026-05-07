---
name: jira-browser-fetch
description: Fetch Jira issue raw data through an authenticated Chrome browser session when jira-cli/API tokens do not work, especially with Microsoft/SSO. Use to archive Jira issues, Jira Software board backlogs, JQL result sets, linked tickets, rendered HTML/XML, remote links, and attachments into a raw wiki folder.
license: MIT
compatibility: Agent Skills standard. Tested with Pi; installable into Claude Code, Codex, OpenClaw/generic .agents skills directories. Requires Node.js 22+ with built-in fetch/WebSocket and a Chromium-compatible browser with remote debugging (Chrome, Chromium, Brave, Edge, or Vivaldi). No npm dependencies.
---

# Jira Browser Fetch

Use this skill when Jira API-token authentication fails or the organization uses Microsoft/SSO and the user wants Jira issues, Jira Software board backlogs, or JQL result sets archived into a local raw/wiki folder.

The bundled script opens/reuses Chrome with a dedicated profile, lets the user complete SSO once, extracts Jira cookies via Chrome DevTools, verifies they represent an authenticated Jira REST session, and fetches Jira REST/HTML/XML/attachments into a raw directory.

## Safety

- Never ask the user to paste Jira cookies or API tokens into chat.
- Prefer the browser automation flow because secrets remain in the local Chrome profile.
- Treat fetched issue data and attachments as potentially confidential.
- Do not update/transition/edit Jira issues with this skill; it is read-only.

## Script

```bash
scripts/jira-browser-fetch.js ISSUE-KEY [options]
```

Important options:

```bash
--server URL       Jira base URL, e.g. https://example.atlassian.net
--raw-dir DIR      folder where ISSUE-KEY/ directories are created
--connected        fetch connected/referenced tickets too
--depth N          recursion depth for connected tickets
--scan-text        find issue keys in JSON/XML/HTML text, not only formal Jira links
--jql JQL          search Jira with JQL and fetch all matching issues
--backlog URL|ID   fetch all issues from a Jira Software board backlog URL or board id
--assignee-me      fetch all issues assigned to current Jira user
--max-attachment-size S  skip attachment files larger than S (default 5mb; use unlimited to disable)
--prefix A,B,C     only follow keys with these project prefixes
--wait SEC         SSO/session wait timeout per issue
```

## Example User Requests

Use this skill for user requests like:

- "Fetch Jira issue `PROJ-123` into `raw/` through my browser session."
- "Archive this Jira backlog for my LLM wiki: `https://example.atlassian.net/jira/software/c/projects/ABC/boards/42/backlog?epics=visible`."
- "Fetch all Jira issues matching this JQL into the wiki raw folder."
- "Pull my assigned Jira issues without asking me for an API token."
- "Fetch this ticket and all linked tickets, including attachments under the default size limit."

## Typical Workflow

1. Identify raw directory.
2. Run the script and show the command first.
3. If Chrome opens, ask the user to complete SSO in that browser window.
4. To share one Atlassian SSO login with `confluence-browser-fetch`, use `ATLASSIAN_CHROME_PROFILE` plus `ATLASSIAN_CHROME_DEBUG_PORT` (or matching `--profile-dir` and `--port`) for both tools.
5. Verify saved files.

Example:

```bash
scripts/jira-browser-fetch.js \
  SWING-4770 \
  --server https://example.atlassian.net \
  --raw-dir ./raw \
  --connected \
  --scan-text \
  --prefix SWING,SSD,EC \
  --depth 1

# Fetch requested issues plus everything assigned to current user:
scripts/jira-browser-fetch.js \
  SWING-4611 SWING-4621 \
  --server https://example.atlassian.net \
  --raw-dir ./raw \
  --assignee-me

# Fetch every issue currently visible in a Jira Software board backlog:
scripts/jira-browser-fetch.js \
  --server https://example.atlassian.net \
  --raw-dir ./raw \
  --backlog 'https://example.atlassian.net/jira/software/c/projects/ABC/boards/42/backlog?epics=visible'
```

## Output Layout

For each issue:

```text
raw/ISSUE-KEY/
├── issue.json           # Jira REST issue with renderedFields,names,schema,changelog
├── issue.html           # Browser issue page HTML
├── issue.xml            # Jira XML issue view
├── remotelinks.json     # Jira remote links endpoint
├── connected-keys.json  # Connected/referenced issue keys detected
├── metadata.json        # Fetch metadata
├── attachments.json     # Attachment manifest, including skipped large-file references
└── attachments/         # Downloaded attachments under max-size threshold
```

A run manifest is written to:

```text
raw/jira-browser-fetch-run.json
```

Backlog fetches also write:

```text
raw/jira-board-<board-id>-backlog.json
```

## Installation / PATH

The skill can be used directly by path. Optionally install a convenience symlink:

```bash
mkdir -p ~/.local/bin
ln -sf ~/.pi/agent/skills/jira-browser-fetch/scripts/jira-browser-fetch.js ~/.local/bin/jira-browser-fetch
```

Then use:

```bash
jira-browser-fetch SWING-4770 --raw-dir ./raw --connected
```

## References

- [Usage reference](references/usage.md)
- [Distribution guide](references/distribution.md)
