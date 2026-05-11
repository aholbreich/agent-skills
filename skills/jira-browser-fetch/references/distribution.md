# Distribution Guide

This skill follows Pi / Agent Skills layout:

```text
jira-browser-fetch/
├── SKILL.md
├── scripts/
│   ├── atlassian-browser.js   # vendored from lib/atlassian-browser.js
│   ├── jira-browser-fetch.js
│   └── lib.js
└── references/
    ├── usage.md
    └── distribution.md
```

`scripts/atlassian-browser.js` is vendored from `lib/atlassian-browser.js` at the repo root by `bin/vendor.js` (run via `npm run vendor`, and automatically before `npm test` and `npm pack`). The skill folder is self-contained, so copying just the `jira-browser-fetch/` directory works once vendoring has happened. If you hand-copy from a fresh source checkout, run `npm run vendor` first or include all three files in `scripts/`.

## Install for Current User

Copy the whole directory to Pi's global skill location:

```bash
mkdir -p ~/.pi/agent/skills
cp -a jira-browser-fetch ~/.pi/agent/skills/
```

Pi discovers it automatically on next start.

Optional command symlink:

```bash
mkdir -p ~/.local/bin
ln -sf ~/.pi/agent/skills/jira-browser-fetch/scripts/jira-browser-fetch.js ~/.local/bin/jira-browser-fetch
```

## Install in a Project Repository

For a repo-local skill:

```bash
mkdir -p .pi/skills
cp -a jira-browser-fetch .pi/skills/
```

Commit it:

```bash
git add .pi/skills/jira-browser-fetch
git commit -m "Add Jira browser fetch Pi skill"
```

Anyone using Pi inside that repository gets the skill automatically.

## Distribute as a Tarball

From the parent directory:

```bash
tar -czf jira-browser-fetch-skill.tar.gz jira-browser-fetch
```

Install from tarball:

```bash
mkdir -p ~/.pi/agent/skills
tar -xzf jira-browser-fetch-skill.tar.gz -C ~/.pi/agent/skills
```

## Distribute as a Git Repository

Create a repo with the skill directory as content or as `skills/jira-browser-fetch`.

Consumers can either copy it:

```bash
git clone <repo-url>
cp -a <repo>/jira-browser-fetch ~/.pi/agent/skills/
```

or reference it in Pi settings if they keep a checkout:

```json
{
  "skills": ["/path/to/repo/jira-browser-fetch"]
}
```

## npm/package.json Distribution

Pi can discover package skills from `skills/` directories or `pi.skills` entries in `package.json`.

Example package layout:

```text
my-pi-skills/
├── package.json
└── skills/
    └── jira-browser-fetch/
        ├── SKILL.md
        ├── scripts/jira-browser-fetch.js
        └── references/
```

Minimal `package.json`:

```json
{
  "name": "my-pi-skills",
  "version": "1.0.0",
  "private": true,
  "pi": {
    "skills": ["skills/jira-browser-fetch"]
  }
}
```

## Validation Checklist

- Directory name matches `name` in `SKILL.md`: `jira-browser-fetch`.
- `SKILL.md` has required `name` and `description` frontmatter.
- Scripts use relative paths in docs.
- No secrets, cookies, or tokens are committed.
- Script is executable:

```bash
chmod +x scripts/jira-browser-fetch.js
```
