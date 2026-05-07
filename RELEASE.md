# Release Process

This package is published to the public npm registry as:

```text
@aholbreich/agent-skills
```

Maintainer commands use **pnpm** for checks, tests, packaging, and version bumps. The GitHub release workflow uses the official **npm CLI** for the final publish because npm Trusted Publishing/provenance is best supported there.

##  release strategy

Use a small, explicit SemVer + Git tag workflow:

- `main` is always releasable.
- Pull requests run syntax checks, unit tests, and package dry-run checks.
- Releases are created by `pnpm version patch|minor|major`.
- `package.json` uses plain SemVer, e.g. `0.2.0`.
- Git tags use the standard npm `v` prefix, e.g. `v0.2.0`.
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
pnpm version patch   # bug fixes; creates tag vX.Y.Z
pnpm version minor   # new backwards-compatible features; creates tag vX.Y.Z
pnpm version major   # breaking changes; creates tag vX.Y.Z
```

The repository `.npmrc` pins:

```ini
tag-version-prefix=v
```

So the correct state after `pnpm version minor` is for example:

```text
package.json: "version": "0.2.0"
git tag:      v0.2.0
```

Do not create tags like `0.2.0` or `v.0.2.0`.

Push commit and tag:

```bash
git push origin main --follow-tags
```

The tag starts the `release` GitHub Actions workflow. The release job uses Node.js 24 so the bundled npm CLI is new enough for Trusted Publishing/provenance. The workflow validates with pnpm, then publishes to npm with:

```bash
npm publish --access public --provenance
```

This is intentional: pnpm is used for maintainer ergonomics, while npm CLI is used for npm Trusted Publishing/OIDC provenance.

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

Test Skills CLI discovery, which is the recommended cross-agent install path:

```bash
npx skills add aholbreich/agent-skills --list
# Optional smoke test in an empty temp directory:
# npx skills add aholbreich/agent-skills -g --skill '*' -y
```

Test the package fallback npx/npm-exec installer:

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
