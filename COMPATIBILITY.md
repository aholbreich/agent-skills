# Compatibility

This package is designed as a pure [Agent Skills](https://agentskills.io/) package.

Each bundled skill is a directory containing `SKILL.md` plus scripts and references. The frontmatter follows the Agent Skills conventions: required `name` and `description`, directory name matching the skill name, lowercase hyphenated names, and optional `license`/`compatibility` metadata.

## Compatibility matrix

| Tool / Harness | Status | Install method |
|---|---:|---|
| Pi | Supported and tested | `pi install npm:@aholbreich/agent-skills` or `npx @aholbreich/agent-skills --target pi` |
| Claude Code | Compatible Agent Skills layout | `npx @aholbreich/agent-skills --target claude` or copy `skills/*` into Claude's skills directory |
| OpenAI Codex | Compatible Agent Skills layout | `npx @aholbreich/agent-skills --target codex` or copy `skills/*` into Codex's skills directory |
| OpenClaw / generic Agent Skills harnesses | Compatible Agent Skills layout | `npx @aholbreich/agent-skills --target agents` or copy `skills/*` into `.agents/skills` / configured skills directory |
| Any Agent Skills-compatible tool | Compatible layout | Copy each folder under `skills/` into the tool's configured skills directory |

## Install commands

### Generic Agent Skills default

```bash
npx @aholbreich/agent-skills
```

This installs to `~/.agents/skills` and is equivalent to:

```bash
npx @aholbreich/agent-skills --target agents
```

### Pi global

```bash
pi install npm:@aholbreich/agent-skills
```

or:

```bash
npx @aholbreich/agent-skills --target pi
```

### Pi project-local

```bash
pi install -l npm:@aholbreich/agent-skills
```

or:

```bash
npx @aholbreich/agent-skills --target project
```

### Claude Code

```bash
npx @aholbreich/agent-skills --target claude
```

Project-local Claude-style install:

```bash
npx @aholbreich/agent-skills --target project-claude
```

### Codex

```bash
npx @aholbreich/agent-skills --target codex
```

Project-local Codex-style install:

```bash
npx @aholbreich/agent-skills --target project-codex
```

### Generic `.agents/skills`

```bash
npx @aholbreich/agent-skills --target agents
```

Project-local generic install:

```bash
npx @aholbreich/agent-skills --target project-agents
```

### Custom skills directory

```bash
npx @aholbreich/agent-skills install --dir /path/to/skills
```

## Discoverability

The package is tagged for discovery with npm keywords including:

- `pi-package`
- `agent-skills`
- `agent-skill`
- `agentskills`
- `skills.sh`
- `claude-code`
- `codex`

After publishing to npm, tools and indexes that crawl npm packages for Agent Skills-compatible packages, such as skills registries, should be able to discover the package from its package metadata and conventional `skills/` directory.

If a registry requires manual submission, use:

```text
Package: @aholbreich/agent-skills
Repository: https://github.com/aholbreich/agent-skills
Skills directory: skills/
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
- `pnpm pack --dry-run` package content check.

The compliance tests are intentionally local and dependency-free; they validate the parts of the Agent Skills structure that matter for broad tool compatibility.
