# Compatibility

This package is designed as a pure [Agent Skills](https://agentskills.io/) package.

Each bundled skill is a directory containing `SKILL.md` plus scripts and references. The frontmatter follows the Agent Skills conventions: required `name` and `description`, directory name matching the skill name, lowercase hyphenated names, and optional `license`/`compatibility` metadata.

## Recommended installer

For cross-agent installation, prefer the open Skills CLI:

```bash
npx skills add aholbreich/agent-skills -g
```

The Skills CLI discovers `skills/*/SKILL.md`, supports many agent clients, and symlinks agent-specific installs to a managed source by default. Use `--copy` only when symlinks are not supported.

Useful variants:

```bash
npx skills add aholbreich/agent-skills --list
npx skills add aholbreich/agent-skills              # project-local/team install
npx skills add aholbreich/agent-skills -g -y        # non-interactive global install
npx skills update -g                                # update global skills installed by the Skills CLI
npx skills list -g                                  # list global skills
```

## Compatibility matrix

| Tool / Harness | Status | Recommended install method |
|---|---:|---|
| Pi | Supported and tested | `pi install npm:@aholbreich/agent-skills` for Pi-managed package updates, or `npx skills add aholbreich/agent-skills -g` for cross-agent installs |
| Claude Code | Compatible Agent Skills layout | `npx skills add aholbreich/agent-skills -g --agent claude-code` |
| OpenAI Codex | Compatible Agent Skills layout | `npx skills add aholbreich/agent-skills -g --agent codex` |
| OpenClaw / generic Agent Skills harnesses | Compatible Agent Skills layout | `npx skills add aholbreich/agent-skills -g` or install to `.agents/skills` |
| Any Agent Skills-compatible tool | Compatible layout | Copy or symlink each folder under `skills/` into the tool's configured skills directory |

## Pi-native install commands

Pi can install this repository as a Pi package directly from npm:

```bash
pi install npm:@aholbreich/agent-skills
```

Project-local Pi package install:

```bash
pi install -l npm:@aholbreich/agent-skills
```

Temporary Pi run without installing:

```bash
pi -e npm:@aholbreich/agent-skills
```

## Package fallback installer

The npm package also ships a small dependency-free installer for environments where the Skills CLI is not available:

```bash
npx @aholbreich/agent-skills
```

This installs to `~/.agents/skills` and is equivalent to:

```bash
npx @aholbreich/agent-skills --target agents
```

Other targets:

```bash
npx @aholbreich/agent-skills --target pi
npx @aholbreich/agent-skills --target claude
npx @aholbreich/agent-skills --target codex
npx @aholbreich/agent-skills --target project
npx @aholbreich/agent-skills --target project-agents
npx @aholbreich/agent-skills install --dir /path/to/skills
```

Select one or more skills with `--skill`, or use the interactive picker:

```bash
npx @aholbreich/agent-skills install --skill jira-browser-fetch
npx @aholbreich/agent-skills install --skill jira-browser-fetch --skill confluence-browser-fetch
npx @aholbreich/agent-skills install --pick
```

This fallback copies files. For symlinked, multi-agent installs, prefer `npx skills add aholbreich/agent-skills`.

## Collision behavior

Agent Skills are identified by their `name` frontmatter. If the same skill name exists in more than one discovered location, agents apply their own precedence rules.

Common precedence pattern:

1. Project-local skills override user/global skills.
2. User/global skills override bundled/system skills.
3. Duplicate names are not merged.

Pi example:

```text
.pi/skills/jira-browser-fetch/SKILL.md
```

shadows:

```text
~/.nvm/.../@aholbreich/agent-skills/skills/jira-browser-fetch/SKILL.md
```

That is useful for intentional repo-specific overrides, but it also means package updates may not affect the active skill in that repository. If you see a collision warning, choose one source of truth:

- Keep the project-local skill if the repository intentionally customizes it.
- Remove the project-local copy if you want the package/global install to be active.
- Re-run the installer/update command for the install method that owns the active copy.

## Discoverability

The package is tagged for discovery with npm keywords including:

- `pi-package`
- `agent-skills`
- `agent-skill`
- `agentskills`
- `skills.sh`
- `claude-code`
- `codex`

The repository is also compatible with the Skills CLI GitHub shorthand:

```bash
npx skills add aholbreich/agent-skills --list
```

If a registry requires manual submission, use:

```text
Package: @aholbreich/agent-skills
Repository: https://github.com/aholbreich/agent-skills
Skills directory: skills/
Install command: npx skills add aholbreich/agent-skills -g
```

## Compliance checks in this repo

CI runs:

```bash
pnpm run ci
```

That includes:

- JavaScript syntax checks.
- Unit tests.
- Skill frontmatter compliance checks.
- `npm pack --dry-run` package content check.

The compliance tests are intentionally local and dependency-free; they validate the parts of the Agent Skills structure that matter for broad tool compatibility.
