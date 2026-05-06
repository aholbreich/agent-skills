# Contributing

Thanks for improving this skill collection.

## Development setup

Requirements:

- Node.js 22+
- Chrome/Chromium for manual end-to-end testing
- Pi if you want to test skill discovery

Run checks and tests:

```bash
npm run check
npm test
npm run ci
```

## Skill guidelines

- Keep skills self-contained under `skills/<skill-name>/`.
- `SKILL.md` frontmatter `name` must match the directory name.
- Prefer no runtime dependencies. If dependencies are needed, add them to `package.json`.
- Do not commit fetched `raw/` data, browser profiles, cookies, tokens, customer data, or logs.
- Keep scripts read-only unless the skill is explicitly meant to modify external systems.
- Document safety assumptions in the skill and in `SECURITY.md` if relevant.

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

Then delete local test exports before committing.

## Release checklist

1. `npm run ci`
2. update `CHANGELOG.md`
3. bump `package.json` version
4. commit changes
5. tag release, e.g. `v0.1.0`
6. push tag
