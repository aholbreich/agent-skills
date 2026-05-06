# Release Process

This package is intended to be published to the public npm registry as:

```text
@aholbreich/agent-skills
```

## Recommended release strategy

Use a small, explicit SemVer + Git tag workflow:

- `main` is always releasable.
- Pull requests run syntax checks, unit tests, and package dry-run checks.
- Releases are created by `npm version patch|minor|major`.
- Pushing the generated `vX.Y.Z` tag triggers GitHub Actions.
- GitHub Actions publishes to npm with provenance via npm Trusted Publishing.

## One-time npm setup

### 1. Ensure npm account and scope

Create or log into an npm account that owns the `@aholbreich` scope.

Check locally:

```bash
npm whoami
npm org ls aholbreich 2>/dev/null || true
```

For scoped public packages, `package.json` already contains:

```json
"publishConfig": {
  "access": "public"
}
```

### 2. First publish / Trusted Publishing

Best practice is npm Trusted Publishing, which avoids long-lived npm tokens.

In npm package settings, configure a trusted publisher for:

```text
Repository: aholbreich/agent-skills
Workflow: .github/workflows/release.yml
Environment: leave empty unless you add one
```

If the package does not exist yet and npm does not allow configuring trusted publishing before first publish, do the first publish manually:

```bash
npm login
npm run ci
npm publish --access public
```

Then configure Trusted Publishing for all later releases.

Alternative, if you do not use Trusted Publishing: create an npm automation token and add it as GitHub secret `NPM_TOKEN`, then modify the release workflow to pass `NODE_AUTH_TOKEN`. This is less preferred than Trusted Publishing.

## Release steps

From a clean `main` branch:

```bash
git checkout main
git pull --ff-only
npm run ci
```

Update `CHANGELOG.md`, then bump version:

```bash
npm version patch   # bug fixes
npm version minor   # new backwards-compatible features
npm version major   # breaking changes
```

Push commit and tag:

```bash
git push origin main --follow-tags
```

The tag starts the `release` GitHub Actions workflow and publishes to npm.

## Versioning guidance

Follow SemVer:

- `patch`: docs, bug fixes, robust retry behavior, small compatibility fixes.
- `minor`: new options, new skills, new supported source types.
- `major`: breaking CLI flags, changed output layout, changed minimum Node version, changed skill names.

## Verify after publish

```bash
npm view @aholbreich/agent-skills version
npm view @aholbreich/agent-skills dist-tags
```

Install globally:

```bash
npm install -g @aholbreich/agent-skills
agent-skills list
jira-browser-fetch --help
confluence-browser-fetch --help
```

Test one-shot npx installer:

```bash
npx @aholbreich/agent-skills list
npx @aholbreich/agent-skills paths
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
npm run ci
```

The package should include only docs and `skills/`. It must not include fetched `raw/` exports, browser profiles, logs, cookies, or tokens.
