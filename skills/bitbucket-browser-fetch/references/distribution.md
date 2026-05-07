# Bitbucket Browser Fetch Distribution

This skill is distributed as part of `@aholbreich/agent-skills`.

Directory layout:

```text
bitbucket-browser-fetch/
├── SKILL.md
├── references/
│   ├── distribution.md
│   └── usage.md
└── scripts/
    ├── bitbucket-browser-fetch.js
    └── lib.js
```

Use directly by path or install a convenience symlink:

```bash
mkdir -p ~/.local/bin
ln -sf ~/.pi/agent/skills/bitbucket-browser-fetch/scripts/bitbucket-browser-fetch.js ~/.local/bin/bitbucket-browser-fetch
```

The package exposes a `bitbucket-browser-fetch` npm bin when installed globally.
