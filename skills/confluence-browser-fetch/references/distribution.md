# Distribution Guide

This skill follows the Agent Skills layout and is self-contained after vendoring:

```text
confluence-browser-fetch/
├── SKILL.md
├── scripts/
│   ├── browser-context.js              # vendored from lib/
│   ├── launch-windows-browser.ps1      # vendored from lib/
│   ├── confluence-browser-fetch.js
│   ├── confluence-deployment.js
│   └── lib.js
└── references/
    ├── usage.md
    ├── development.md
    └── distribution.md
```

The legacy `atlassian-browser.js` is neither imported nor packaged in this skill.

## Source development

After editing either shared source:

```text
lib/browser-context.js
lib/launch-windows-browser.ps1
```

regenerate and verify the committed skill copies:

```bash
npm run vendor
npm run vendor:check
npm run ci
```

`bin/vendor.js` declares consumers explicitly. The browser-context runtime and PowerShell launcher are vendored only to this skill.

## Recommended installation

```bash
npx skills add aholbreich/agent-skills -g --skill confluence-browser-fetch -y
```

Pi package:

```bash
pi install npm:@aholbreich/agent-skills
```

Fallback installer:

```bash
npx @aholbreich/agent-skills install --skill confluence-browser-fetch
```

## Manual installation

```bash
mkdir -p ~/.agents/skills
cp -a skills/confluence-browser-fetch ~/.agents/skills/
```

Optional command symlink:

```bash
mkdir -p ~/.local/bin
ln -sf ~/.agents/skills/confluence-browser-fetch/scripts/confluence-browser-fetch.js ~/.local/bin/confluence-browser-fetch
```

## Package requirements

- Node.js 22+.
- Native Chromium, or Windows Chrome/Edge plus PowerShell interoperability under WSL.
- All JavaScript and PowerShell files listed above.
- Executable bit on `confluence-browser-fetch.js`.

No npm runtime dependency is required.

## Validation checklist

- Directory and frontmatter name both equal `confluence-browser-fetch`.
- `npm run vendor:check` passes.
- `node --check` passes for all JavaScript.
- Unit tests and `npm pack --dry-run` pass.
- Packed skill includes `browser-context.js` and `launch-windows-browser.ps1`.
- No raw output, browser profile, cookie, SAML value, token, private host, or customer fixture is included.
