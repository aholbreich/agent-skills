# Confluence Update Distribution

This skill is distributed as part of `@aholbreich/agent-skills`.

Directory layout:

```text
confluence-update/
├── SKILL.md
├── references/
│   └── usage.md
└── scripts/
    ├── confluence-update.js
    └── lib.js
```

Use directly by path or install a convenience symlink:

```bash
mkdir -p ~/.local/bin
ln -sf ~/.pi/agent/skills/confluence-update/scripts/confluence-update.js ~/.local/bin/confluence-update
```

The package also exposes a `confluence-update` npm bin when installed globally.
