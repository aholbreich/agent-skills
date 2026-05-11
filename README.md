# Agent Skills

**Browser-authenticated Atlassian write surface for SSO-locked organizations.** Five [Agent Skills](https://agentskills.io/) covering Jira read+write, Confluence read+write, and Bitbucket read — designed for orgs where Microsoft/SSO blocks API-token use.

The package is a pure Agent Skills bundle, compatible with Pi, Claude Code, Codex, OpenClaw / generic `.agents` setups, and other Agent Skills-compatible harnesses.

## Why this exists

Most Atlassian automation tools assume API tokens. In SSO-locked enterprises, API tokens are often disabled or restricted in ways that make scripted writes painful. These skills route through an authenticated **browser session** instead — you log in to Jira/Confluence/Bitbucket once in Chrome, and the skills replay your cookies via DevTools to make REST calls. No API token required.

Beyond the SSO bypass, the skills are built around three differentiators:

- **Dry-run-first writes.** Every write command (`jira-update create`, `confluence-update replace-block`, etc.) emits a full audit folder under `raw/` first. You only get a real write when you re-run with `--apply`. Each audit folder contains the proposed payload, the before-state, and a diff summary — review exactly what would happen before it does.
- **Markdown → ADF conversion.** `jira-update` converts Markdown to Atlassian Document Format (Jira Cloud's structured rich-text representation), so agents write descriptions, comments, and transitions in a familiar format without hand-rolling ADF JSON.
- **Shared browser session.** All Atlassian skills can reuse a single Chrome profile + DevTools port, so you log in once and every fetch/update skill rides the same SSO session.

## Project status

Opinionated bundle: SSO browser-session auth only, no API tokens or app passwords. The whole stack is built around extracting Chrome cookies via the DevTools Protocol — if API tokens already work for your org, you do not need this. All five Atlassian skills share one Chrome profile (`~/.local/share/atlassian-browser-chrome`) and DevTools port (`9223`) by default; log in once and the others reuse the session.

**Tested on Linux (Fedora) at the moment.** macOS browser paths exist in the auto-detection logic but are not end-to-end verified; Windows is unsupported. Reports of what works on other distros or OSes are very welcome — open an issue or PR at [github.com/aholbreich/agent-skills/issues](https://github.com/aholbreich/agent-skills/issues). Feedback on SSO flavors, browser detection, profile/port collisions, and unusual Atlassian tenant shapes is especially useful.

## Skills

| Skill | Purpose |
|---|---|
| [`jira-browser-fetch`](skills/jira-browser-fetch/) | Fetch Jira issue JSON, rendered HTML/XML, linked/referenced issues, Jira Software board backlogs, JQL result sets, and attachments through an authenticated Chrome session. |
| [`jira-update`](skills/jira-update/) | Dry-run-first Jira Cloud writes through an authenticated browser session: create issues, add comments, transition workflows, update fields, and link issues. Markdown-to-ADF conversion by default; ADF passthrough as escape hatch. |
| [`confluence-browser-fetch`](skills/confluence-browser-fetch/) | Fetch Confluence page JSON, storage/view HTML, browser HTML, descendants, CQL result sets, and attachments through an authenticated Chrome session. |
| [`confluence-update`](skills/confluence-update/) | Dry-run-first Confluence page updates, agent-owned block replacement, Markdown-to-storage conversion, and page creation through an authenticated browser session. |
| [`bitbucket-browser-fetch`](skills/bitbucket-browser-fetch/) | Fetch Bitbucket Cloud project repository inventories and clone URL lists through an authenticated browser session. |

## Compatibility

This repository follows the Agent Skills directory convention: each skill lives under `skills/<skill-name>/SKILL.md` with matching frontmatter.

Recommended install paths:

| Use case | Command |
|---|---|
| Cross-agent wizard (recommended) | `npx skills add aholbreich/agent-skills -g` |
| Pi package-managed install | `pi install npm:@aholbreich/agent-skills` |
| Project-local/team skills | `npx skills add aholbreich/agent-skills` |
| Package fallback without the aggregator | `npx @aholbreich/agent-skills` |

See [`COMPATIBILITY.md`](COMPATIBILITY.md) for details, including collision behavior.

## Requirements

- Node.js `>=22`.
- A Chromium-compatible browser: Chrome, Chromium, Brave, Edge, or Vivaldi.
- Access to the Jira/Confluence site in the browser account you use.
- Pi, or any Agent Skills-compatible harness, if you want skill discovery.

No npm runtime dependencies are required.

## Recommended install with the Skills CLI

For most users, use the open `skills` installer. It discovers the skills in this repository, prompts for compatible agents, and symlinks agent-specific installs to a single managed source by default.

Global/user install:

```bash
npx skills add aholbreich/agent-skills -g
```

Project-local install, useful for teams:

```bash
npx skills add aholbreich/agent-skills
```

List available skills without installing:

```bash
npx skills add aholbreich/agent-skills --list
```

Non-interactive examples:

```bash
npx skills add aholbreich/agent-skills -g --skill '*' -y
npx skills add aholbreich/agent-skills -g --agent claude-code --agent codex --skill jira-browser-fetch -y
```

Use `--copy` only when symlinks are not supported in your environment.

## Pi-native install

If you only use Pi and want Pi to manage package updates, install the npm package directly:

```bash
pi install npm:@aholbreich/agent-skills
```

Project-local Pi package install, useful for teams that already standardize on Pi packages:

```bash
pi install -l npm:@aholbreich/agent-skills
```

Try without installing:

```bash
pi -e npm:@aholbreich/agent-skills
```

## Package fallback with npx

If you cannot use the `skills` aggregator, this package also ships a small installer. It copies bundled skills into a selected skills directory.

Install bundled skills into the generic Agent Skills directory `~/.agents/skills`:

```bash
npx @aholbreich/agent-skills
```

Install for a specific target:

```bash
npx @aholbreich/agent-skills install --target agents          # ~/.agents/skills (default)
npx @aholbreich/agent-skills install --target claude          # ~/.claude/skills
npx @aholbreich/agent-skills install --target codex           # ~/.codex/skills
npx @aholbreich/agent-skills install --target pi              # ~/.pi/agent/skills
npx @aholbreich/agent-skills install --target project-agents  # ./.agents/skills
npx @aholbreich/agent-skills install --target project-pi      # ./.pi/skills
```

The bare `--target project` is a deprecated alias for `--target project-pi`; use the explicit form. Run `npx @aholbreich/agent-skills paths` to see every target's full path.

Install only selected skills:

```bash
npx @aholbreich/agent-skills install --skill jira-browser-fetch
npx @aholbreich/agent-skills install --skill confluence-browser-fetch
npx @aholbreich/agent-skills install --skill jira-browser-fetch --target project-agents
```

Or use the dependency-free interactive picker:

```bash
npx @aholbreich/agent-skills install --pick
```

Overwrite existing installed skill directories:

```bash
npx @aholbreich/agent-skills install --target agents --force
```

List bundled skills:

```bash
npx @aholbreich/agent-skills list
```

## Collision and update notes

Avoid installing the same skill into multiple locations for the same agent unless you intentionally want one copy to shadow another. Most agents give project-local skills priority over user/global skills.

For example, in Pi a project skill at `.pi/skills/jira-browser-fetch/SKILL.md` shadows the same skill installed from `npm:@aholbreich/agent-skills`. In that case `pi update` updates the package, but the active project-local copy remains unchanged.

Recommended rule of thumb:

- Cross-agent users: prefer `npx skills add aholbreich/agent-skills -g`.
- Pi-only users: prefer `pi install npm:@aholbreich/agent-skills`.
- Team/repo-specific overrides: commit project-local skills intentionally and update them intentionally.

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
jira-update
confluence-browser-fetch
confluence-update
bitbucket-browser-fetch
```

## Reuse one Atlassian browser login

All five skills share one Chrome profile (`~/.local/share/atlassian-browser-chrome`) and DevTools port (`9223`) by default. Log in once via any skill and the others ride the same SSO session — no env vars required.

To relocate the shared profile or run on a different port:

```bash
export ATLASSIAN_CHROME_PROFILE="$HOME/some/other/path"
export ATLASSIAN_CHROME_DEBUG_PORT=9333
```

Skill-specific variables (`JIRA_CHROME_PROFILE`, `CONFLUENCE_CHROME_PROFILE`, `BITBUCKET_CHROME_PROFILE`, and the matching `*_CHROME_DEBUG_PORT`) override the shared values when you intentionally want skill isolation.

## Bitbucket examples

Fetch all repositories in a Bitbucket project and write SSH clone URL lists:

```bash
bitbucket-browser-fetch \
  'https://bitbucket.org/myneva/workspace/projects/SWI' \
  --raw-dir ./raw
```

## Confluence update examples

Dry-run an agent-owned block replacement from Markdown:

```bash
confluence-update replace-block 123456 \
  --site https://example.atlassian.net \
  --marker agent-summary \
  --file ./summary.md \
  --representation markdown
```

Apply only after reviewing `raw/confluence-updates/...`:

```bash
confluence-update replace-block 123456 \
  --site https://example.atlassian.net \
  --marker agent-summary \
  --file ./summary.md \
  --representation markdown \
  --apply
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

## Jira update examples

Dry-run an issue creation from a manifest:

```bash
jira-update create \
  --server https://example.atlassian.net \
  --file ./new-bug.json
```

Apply after review:

```bash
jira-update create \
  --server https://example.atlassian.net \
  --file ./new-bug.json \
  --apply
```

Add a comment from Markdown:

```bash
jira-update comment PROJ-123 \
  --server https://example.atlassian.net \
  --file ./reply.md \
  --apply
```

Transition with a comment:

```bash
jira-update transition PROJ-123 \
  --server https://example.atlassian.net \
  --to "In Progress" \
  --comment-file ./status.md \
  --apply
```

Link two issues:

```bash
jira-update link PROJ-123 \
  --server https://example.atlassian.net \
  --to PROJ-456 \
  --type blocks \
  --apply
```

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

## Example workflow: populating an LLM wiki

One common use case for the fetch skills is feeding an LLM-curated knowledge base. The tools populate a `raw/` evidence folder; they do not synthesize pages themselves. A typical pipeline:

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
