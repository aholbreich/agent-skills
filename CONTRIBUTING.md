# Contributing

Thanks for improving this skill collection.

## Development setup

Requirements:

- Node.js 22+
- Chrome/Chromium for manual end-to-end testing
- For Windows/WSL Confluence testing: Windows Chrome/Edge and PowerShell interoperability
- Pi if you want to test skill discovery

Run checks and tests:

```bash
pnpm run check
pnpm test
pnpm run ci
```

## Skill guidelines

- Keep skills self-contained under `skills/<skill-name>/`.
- `SKILL.md` frontmatter `name` must match the directory name.
- Prefer no runtime dependencies. If dependencies are needed, add them to `package.json`.
- Do not commit fetched `raw/` data, browser profiles, cookies, tokens, customer data, or logs.
- Keep scripts read-only unless the skill is explicitly meant to modify external systems.
- Document safety assumptions in the skill and in `SECURITY.md` if relevant.
- Keep shared-file consumers explicit in `bin/vendor.js`; run `npm run vendor` after changing a shared browser runtime.
- Never add a private tenant hostname, page ID, SAML response, or customer-derived HTML/JSON fixture to tests or documentation.
- Preserve the Confluence fetch transport's exact-origin, GET-only, bounded-response, no-cookie-export invariants.

## Testing browser fetchers

Use a test Atlassian site or non-confidential page/issue when possible.

```bash
./skills/jira-browser-fetch/scripts/jira-browser-fetch.js PROJ-123 \
  --server https://example.atlassian.net \
  --raw-dir ./raw-test

./skills/confluence-browser-fetch/scripts/confluence-browser-fetch.js 123456 \
  --site https://example.atlassian.net \
  --raw-dir ./raw-test
```

For Confluence Server/Data Center and Windows/WSL architecture, see `skills/confluence-browser-fetch/references/development.md`. Use synthetic `example.com` fixtures in tests. Private pages may be used only for local end-to-end validation; write output under ignored `raw/` or outside the checkout and delete it after inspection.

Then delete local test exports before committing.

## Release checklist

1. `pnpm run ci`
2. update `CHANGELOG.md`
3. bump `package.json` version
4. commit changes
5. tag release, e.g. `v0.1.0`
6. push tag
