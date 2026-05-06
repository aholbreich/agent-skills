# Distribution Guide

This skill follows Pi / Agent Skills layout:

```text
confluence-browser-fetch/
├── SKILL.md
├── scripts/
│   └── confluence-browser-fetch.js
└── references/
    ├── usage.md
    └── distribution.md
```

## Install for Current User

```bash
mkdir -p ~/.pi/agent/skills
cp -a confluence-browser-fetch ~/.pi/agent/skills/
```

Pi discovers it automatically on next start.

Optional command symlink:

```bash
mkdir -p ~/.local/bin
ln -sf ~/.pi/agent/skills/confluence-browser-fetch/scripts/confluence-browser-fetch.js ~/.local/bin/confluence-browser-fetch
```

## Install in a Project Repository

```bash
mkdir -p .pi/skills
cp -a confluence-browser-fetch .pi/skills/
git add .pi/skills/confluence-browser-fetch
git commit -m "Add Confluence browser fetch Pi skill"
```

## Distribute as a Tarball

From the parent directory:

```bash
tar -czf confluence-browser-fetch-skill.tar.gz confluence-browser-fetch
```

Install from tarball:

```bash
mkdir -p ~/.pi/agent/skills
tar -xzf confluence-browser-fetch-skill.tar.gz -C ~/.pi/agent/skills
```

## Distribute as a Git Repository

Consumers can copy the skill:

```bash
git clone <repo-url>
cp -a <repo>/confluence-browser-fetch ~/.pi/agent/skills/
```

or reference a checkout in Pi settings:

```json
{
  "skills": ["/path/to/repo/confluence-browser-fetch"]
}
```

## npm/package.json Distribution

Pi can discover package skills from `skills/` directories or `pi.skills` entries in `package.json`.

Example package layout:

```text
my-pi-skills/
├── package.json
└── skills/
    └── confluence-browser-fetch/
        ├── SKILL.md
        ├── scripts/confluence-browser-fetch.js
        └── references/
```

Minimal package metadata:

```json
{
  "name": "my-pi-skills",
  "version": "1.0.0",
  "private": true,
  "pi": {
    "skills": ["skills/confluence-browser-fetch"]
  }
}
```

## Validation Checklist

- Directory name matches frontmatter name: `confluence-browser-fetch`.
- `SKILL.md` has `name` and `description`.
- No cookies, API tokens, or secrets are committed.
- Script is executable:

```bash
chmod +x scripts/confluence-browser-fetch.js
```
