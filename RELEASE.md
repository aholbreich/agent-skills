# Release Process

This package is published to the public npm registry as:

```text
@aholbreich/agent-skills
```

Maintainer commands use **pnpm**. The registry is still npm, so the final publish command is `pnpm publish` to npm.

##  release strategy

Use a small, explicit SemVer + Git tag workflow:

- `main` is always releasable.
- Pull requests run syntax checks, unit tests, and package dry-run checks.
- Releases are created by `pnpm version patch|minor|major`.
- Pushing the generated `vX.Y.Z` tag triggers GitHub Actions.
- GitHub Actions publishes to npm with provenance via npm Trusted Publishing.

## Release steps

From a clean `main` branch:

```bash
git checkout main
git pull --ff-only
pnpm run ci
```

Update `CHANGELOG.md`, then bump version:

```bash
pnpm version patch   # bug fixes
pnpm version minor   # new backwards-compatible features
pnpm version major   # breaking changes
```

Push commit and tag:

```bash
git push origin main --follow-tags
```

The tag starts the `release` GitHub Actions workflow and publishes to npm with:

```bash
pnpm publish --access public --provenance --no-git-checks
```

## Versioning guidance

Follow SemVer:

- `patch`: docs, bug fixes, robust retry behavior, small compatibility fixes.
- `minor`: new options, new skills, new supported source types.
- `major`: breaking CLI flags, changed output layout, changed minimum Node version, changed skill names.

## Verify after publish

```bash
pnpm view @aholbreich/agent-skills version
pnpm view @aholbreich/agent-skills dist-tags
```

Install globally:

```bash
pnpm add -g @aholbreich/agent-skills
agent-skills list
jira-browser-fetch --help
confluence-browser-fetch --help
```

Test one-shot npx/npm-exec installer:

```bash
pnpm dlx @aholbreich/agent-skills list
pnpm dlx @aholbreich/agent-skills paths
# npm users can also use:
npx @aholbreich/agent-skills list
```

Install in Pi:

```bash
pi install npm:@aholbreich/agent-skills
```

Project-local Pi install:

```bash
pi install -l npm:@aholbreich/agent-skills
```

## Dry run package contents

Always inspect package contents before publishing:

```bash
pnpm run ci
```

The package should include only docs, `bin/`, and `skills/`. It must not include fetched `raw/` exports, browser profiles, logs, cookies, or tokens.
