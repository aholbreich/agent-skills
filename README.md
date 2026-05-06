# Agent Skills

Handcrafted [Agent Skills](https://agentskills.io/) for developer and LLM-wiki workflows. The package is intentionally a pure skills package with broad compatibility across Pi, Claude Code, Codex, OpenClaw/generic `.agents` setups, and other Agent Skills-compatible harnesses.

This repository is a pure skills package. It currently contains browser-authenticated Atlassian fetchers that work well when Jira/Confluence API-token authentication is unavailable because an organization uses Microsoft/SSO.

## Skills

| Skill | Purpose |
|---|---|
| [`jira-browser-fetch`](skills/jira-browser-fetch/) | Fetch Jira issue JSON, rendered HTML/XML, linked/referenced issues, Jira Software board backlogs, JQL result sets, and attachments through an authenticated Chrome session. |
| [`confluence-browser-fetch`](skills/confluence-browser-fetch/) | Fetch Confluence page JSON, storage/view HTML, browser HTML, descendants, CQL result sets, and attachments through an authenticated Chrome session. |

## Compatibility

This repository follows the Agent Skills directory convention: each skill lives under `skills/<skill-name>/SKILL.md` with matching frontmatter.

Supported install targets:

| Target | Command |
|---|---|
| Pi | `pi install npm:@aholbreich/agent-skills` |
| Pi via npx | `npx @aholbreich/agent-skills --target pi` |
| Claude Code-style global skills | `npx @aholbreich/agent-skills --target claude` |
| Codex-style global skills | `npx @aholbreich/agent-skills --target codex` |
| OpenClaw / generic `.agents/skills` | `npx @aholbreich/agent-skills --target agents` |
| Project-local generic skills | `npx @aholbreich/agent-skills --target project-agents` |

See [`COMPATIBILITY.md`](COMPATIBILITY.md) for details.

## Requirements

- Node.js `>=22`.
- Google Chrome or Chromium.
- Access to the Jira/Confluence site in the browser account you use.
- Pi, or any Agent Skills-compatible harness, if you want skill discovery.

No npm runtime dependencies are required.

## Install with Pi

From GitHub:

```bash
pi install git:github.com/aholbreich/agent-skills
```

Project-local install, useful for teams:

```bash
pi install -l git:github.com/aholbreich/agent-skills
```

Try without installing:

```bash
pi -e git:github.com/aholbreich/agent-skills
```

## One-shot install with npx

Install bundled skills into the generic Agent Skills directory `~/.agents/skills`:

```bash
npx @aholbreich/agent-skills
```

This is equivalent to:

```bash
npx @aholbreich/agent-skills --target agents
```

Install into a project-local `.pi/skills` directory:

```bash
npx @aholbreich/agent-skills install --target project
```

Install for Claude Code, Codex, or generic Agent Skills harnesses:

```bash
npx @aholbreich/agent-skills install --target claude
npx @aholbreich/agent-skills install --target codex
npx @aholbreich/agent-skills install --target agents
```

Overwrite existing installed skill directories:

```bash
npx @aholbreich/agent-skills install --target agents --force
```

List bundled skills:

```bash
npx @aholbreich/agent-skills list
```

## Manual install

```bash
git clone https://github.com/aholbreich/agent-skills.git
mkdir -p ~/.pi/agent/skills
cp -a agent-skills/skills/* ~/.pi/agent/skills/
```

Optional command symlinks:

```bash
mkdir -p ~/.local/bin
ln -sf ~/.pi/agent/skills/jira-browser-fetch/scripts/jira-browser-fetch.js ~/.local/bin/jira-browser-fetch
ln -sf ~/.pi/agent/skills/confluence-browser-fetch/scripts/confluence-browser-fetch.js ~/.local/bin/confluence-browser-fetch
```

## npm-style command use from checkout

From this repository:

```bash
pnpm run check
./skills/jira-browser-fetch/scripts/jira-browser-fetch.js --help
./skills/confluence-browser-fetch/scripts/confluence-browser-fetch.js --help
```

If installed globally via npm, the package exposes:

```bash
agent-skills
jira-browser-fetch
confluence-browser-fetch
```

## Jira examples

Fetch one issue:

```bash
jira-browser-fetch PROJ-123 \
  --server https://example.atlassian.net \
  --raw-dir ./raw
```

Fetch linked/referenced tickets too:

```bash
jira-browser-fetch PROJ-123 \
  --server https://example.atlassian.net \
  --raw-dir ./raw \
  --connected \
  --scan-text \
  --depth 1
```

Fetch all issues assigned to the current Jira user:

```bash
jira-browser-fetch \
  --server https://example.atlassian.net \
  --raw-dir ./raw \
  --assignee-me
```

Fetch a JQL result set:

```bash
jira-browser-fetch \
  --server https://example.atlassian.net \
  --raw-dir ./raw \
  --jql 'assignee = currentUser() ORDER BY updated DESC'
```

Fetch a Jira Software board backlog:

```bash
jira-browser-fetch \
  --server https://example.atlassian.net \
  --raw-dir ./raw \
  --backlog 'https://example.atlassian.net/jira/software/c/projects/ABC/boards/42/backlog?epics=visible'
```

Example user requests that should invoke this skill:

- "Fetch all Jira issues from this backlog URL into `raw/`."
- "Archive board 42's Jira backlog for my LLM wiki."
- "Fetch `PROJ-123` through my browser session and include linked issues."
- "Pull my assigned Jira issues without asking me for an API token."
- "Use this JQL and store the raw Jira evidence under the wiki raw folder."

## Confluence examples

Fetch one page by URL:

```bash
confluence-browser-fetch \
  'https://example.atlassian.net/wiki/spaces/ABC/pages/123456/Page+Title' \
  --site https://example.atlassian.net \
  --raw-dir ./raw
```

Fetch a page and all descendants:

```bash
confluence-browser-fetch 123456 \
  --site https://example.atlassian.net \
  --raw-dir ./raw \
  --descendants
```

Fetch by CQL:

```bash
confluence-browser-fetch \
  --site https://example.atlassian.net \
  --raw-dir ./raw \
  --cql 'space = ABC and type = page and text ~ "billing"'
```

## Attachment size limits

Both fetchers default to skipping attachment downloads larger than `5mb`. Skipped files are still referenced in `attachments.json` with filename, URL, size, and reason.

```bash
jira-browser-fetch PROJ-123 --server https://example.atlassian.net --max-attachment-size 1mb
confluence-browser-fetch 123456 --site https://example.atlassian.net --max-attachment-size 10mb
```

Disable the limit:

```bash
--max-attachment-size unlimited
```

## Output and LLM wiki use

The tools are designed to populate a wiki `raw/` folder. They do not synthesize pages themselves. A typical LLM wiki workflow is:

1. fetch Jira/Confluence sources into `raw/`,
2. treat `raw/` as immutable evidence,
3. synthesize durable notes into `wiki/`,
4. cite raw paths from wiki pages.

## Security

Read [`SECURITY.md`](SECURITY.md). Do not commit fetched `raw/` exports or browser profiles.

## Development

Run syntax checks and tests:

```bash
pnpm run check
pnpm test
pnpm run ci
```

Tests use Node's built-in test runner and cover pure helper logic plus CLI smoke/error paths. Package validation is intentionally lightweight because the scripts have no runtime npm dependencies.

## License

MIT. See [`LICENSE`](LICENSE).
