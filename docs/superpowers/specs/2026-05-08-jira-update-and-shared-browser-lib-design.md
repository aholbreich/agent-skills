# Design — `jira-update` skill and shared `atlassian-browser` library

Date: 2026-05-08
Status: Approved (brainstorming complete, awaiting implementation plan)

## Goals

1. Add a fifth skill, `jira-update`, that lets coding agents write to Jira through the same browser-authenticated flow used by the other Atlassian skills. Issue creation is the highest-priority command; comments, transitions, field updates, and issue links round out v1.
2. Eliminate ~250 lines of duplicated browser/CDP/cookie code that currently lives in all four existing skills, without breaking single-skill installs.

## Non-goals

- Replacing `jira-browser-fetch` (read path stays as-is).
- Concurrency/version protection on Jira writes — Jira lacks Confluence's clean version integer; v1 documents the race rather than guards against it.
- Agent-block markers in Jira descriptions (deferred to v2).
- Attachments, worklogs, comment delete (deferred to v2).
- Wiki markup as a description representation (legacy on Jira Cloud).

## Architecture

### Shared library

Extract one source of truth at `lib/atlassian-browser.js`. Vendor it into each skill at pack time so each skill folder remains self-contained on disk after install.

```
agent-skills/
├── lib/
│   └── atlassian-browser.js          # NEW: single source of truth
├── skills/
│   ├── bitbucket-browser-fetch/
│   ├── confluence-browser-fetch/
│   ├── confluence-update/
│   ├── jira-browser-fetch/
│   └── jira-update/                   # NEW
└── package.json
```

**Functions extracted into `lib/atlassian-browser.js`:**

- Browser discovery: `findBrowserExecutable`, `resolveBrowserCandidate`, `isExecutable`
- Browser launch: `launchChrome` (parameterized by port + profileDir + initial URL)
- DevTools HTTP: `endpoint`, `devtoolsReady`, `waitDevtools`, `openDevtoolsTab`, `hasDevtoolsTabForHost`
- CDP: `connectCdp`, `getPageWsUrl`, `getCookieHeader`
- HTTP: `fetchText`, `fetchJson`
- Orchestration: `ensureBrowser`, `getCookieWithWait` — `getCookieWithWait` accepts a per-skill `verifySession(cookie) -> {ok, message, url?}` callback so each skill keeps its own probe (Jira `myself`, Confluence `user/current`, Bitbucket project access).

The library exports a small factory:

```js
const { createBrowserSession } = require('./atlassian-browser');
const session = createBrowserSession({
  port, profileDir, waitSec,
  serverHost: new URL(server).host,
  verifySession: cookie => verifyJiraSession(server, cookie),
});
const cookie = await session.getCookieWithWait(`${server}/browse/PROJ-1`);
```

### Pack-time vendoring

- New `npm run vendor` script copies `lib/atlassian-browser.js` to each `skills/*/scripts/atlassian-browser.js`.
- `prepack` hook runs `npm run check && npm run vendor && npm test` so the published tarball contains vendored copies.
- `.gitignore` adds `skills/*/scripts/atlassian-browser.js` — vendored copies are not committed.
- `npm run check` runs `node --check` against `lib/atlassian-browser.js` and against vendored copies if present.
- A vendor-drift test (`test/vendor.test.js`) runs the vendor step and asserts byte-equality between source and each destination — fails CI if a vendored file is hand-edited.
- `bin/agent-skills.js` (selective installer) is unchanged: it copies skill folders, which already include the vendored library after `prepack`.

### Risks and mitigations

- **Drift through hand-edits to vendored copies** → `.gitignore` makes them invisible; `test/vendor.test.js` enforces equality.
- **Single-skill install breakage** → vendored copy lives inside the skill dir, so any install path that copies the skill dir works. Verified by smoke-testing `npx @aholbreich/agent-skills install --skill jira-update --target agents` after the refactor.
- **Test regressions in the 4 existing skills during extraction** → migrate one skill at a time, full `pnpm run ci` between each.

## `jira-update` skill

### Layout

```
skills/jira-update/
├── SKILL.md
├── scripts/
│   ├── jira-update.js          # CLI entry
│   ├── lib.js                  # Markdown→ADF, payload builders, helpers
│   └── atlassian-browser.js    # vendored at pack time
└── references/
    ├── usage.md
    └── distribution.md
```

### Environment and ports

- `JIRA_SERVER` — base URL (e.g. `https://example.atlassian.net`).
- `JIRA_UPDATE_RAW_DIR` → `JIRA_RAW_DIR` → `./raw` for audit dir.
- `JIRA_CHROME_DEBUG_PORT` → `ATLASSIAN_CHROME_DEBUG_PORT` → `9225` (default port for this skill).
- `JIRA_CHROME_PROFILE` → `ATLASSIAN_CHROME_PROFILE` → `~/.local/share/jira-browser-fetch-chrome` (deliberately reuses the fetcher's profile so SSO is shared automatically).
- `JIRA_UPDATE_WAIT_SEC` — SSO/session wait, default 900.

### `bin` entry

`package.json` adds:
```json
"jira-update": "skills/jira-update/scripts/jira-update.js"
```

### Safety model

Mirrors `confluence-update`:
- Dry-run is the default. Every command writes audit files and prints a one-line summary.
- `--apply` is required to execute any write.
- Authenticated Jira REST session is verified (`/rest/api/3/myself`) before any `POST`/`PUT`.
- SKILL.md "Safety" section documents that `update-fields` does **not** detect concurrent edits — agents should re-fetch with `jira-browser-fetch` immediately before calling if drift matters. `before.issue.json` is always saved for forensic recovery.

### Audit dir layout

```
raw/jira-updates/<command>-<key|new>-<timestamp>/
├── before.issue.json         # existing issue (comment | transition | update-fields | link)
├── proposed.payload.json     # exact REST body that would be sent
├── proposed.adf.json         # rendered ADF if Markdown conversion happened
├── transitions.json          # transition: snapshot of available transitions
├── linktypes.json            # link: resolved link-type record
├── after.issue.json          # post-apply only
└── update-run.json           # command metadata
```

### Commands (v1)

#### `create` — new issue

```bash
jira-update create --file issue.json [--apply]
```

`issue.json` shape:
```json
{
  "project": "PROJ",
  "issueType": "Bug",
  "summary": "Login fails on Safari 17",
  "description": "## Steps\n1. Open the login page\n2. ...",
  "descriptionRepresentation": "markdown",
  "labels": ["bug", "browser"],
  "assignee": "accountId:5b10ac...",
  "priority": "High",
  "parent": "PROJ-100",
  "fields": { "customfield_10010": "Q3", "components": [{"name": "frontend"}] }
}
```

- Top-level conveniences: `project`, `issueType`, `summary`, `description`, `labels`, `assignee`, `priority`, `parent`. These map to standard Jira fields.
- `fields` is a passthrough escape hatch merged on top of the assembled `fields` object (last writer wins).
- `descriptionRepresentation` accepts `markdown` (default; converted via `lib.js`) or `adf` (passed through as-is, in which case `description` is an object, not a string).
- POSTs to `/rest/api/3/issue`.

#### `comment` — add comment

```bash
jira-update comment PROJ-123 --file comment.md [--representation markdown|adf] [--apply]
```

Default `markdown`. POSTs to `/rest/api/3/issue/{key}/comment`.

#### `transition` — workflow move

```bash
jira-update transition PROJ-123 --to "In Progress" [--apply]
jira-update transition PROJ-123 --to-id 31 [--comment-file done.md] [--apply]
jira-update transition PROJ-123 --to "Done" --field resolution=Fixed [--apply]
```

- `--to NAME` resolved against `/rest/api/3/issue/{key}/transitions`. If not found, dry-run lists available transitions and exits non-zero.
- `--to-id ID` skips name resolution.
- Optional `--comment-file FILE` for transitions that allow comments.
- Optional `--field key=value` repeated, for transitions that require fields (e.g. `resolution`).
- POSTs to `/rest/api/3/issue/{key}/transitions`.

#### `update-fields` — partial edit

```bash
jira-update update-fields PROJ-123 --file changes.json [--apply]
```

`changes.json`:
```json
{
  "fields": { "summary": "...", "labels": ["x", "y"], "priority": {"name": "Medium"} }
}
```

PUTs to `/rest/api/3/issue/{key}`. No version guard — race documented.

#### `link` — link issues

```bash
jira-update link PROJ-123 --to PROJ-456 --type "blocks" [--apply]
```

- `--type` resolved against `/rest/api/3/issueLinkType` to determine inward/outward direction.
- POSTs to `/rest/api/3/issueLink`.

### Cross-cutting CLI conventions

- `--site URL` / `JIRA_SERVER` env required.
- `--raw-dir DIR` for audit output.
- `--port`, `--profile-dir`, `--wait` follow the existing skills' conventions.
- `--message TEXT` annotates the local audit record (Jira REST endpoints don't accept it; we record it for the agent's later reference).
- `--help` prints command-specific usage when a command is also given; otherwise top-level usage.

## Markdown → ADF conversion

Implemented in `skills/jira-update/scripts/lib.js`. Subset to support in v1:

- Paragraphs (blank-line-separated)
- Headings 1–6 (`# … ######`)
- Unordered lists (`-` or `*`)
- Ordered lists (`1.` / `1)`)
- Inline `code`
- Fenced code blocks (``` ``` ```) with optional language attribute
- `**bold**`, `*italic*`
- `[text](https://url)` links

Anything outside this subset is rendered as plain paragraph text. Agents that need richer formatting (panels, mentions by `accountId`, status macros, attachments inline) pass `descriptionRepresentation: "adf"` and supply the ADF object directly.

Output is always a valid ADF document: `{type:"doc", version:1, content:[…]}`.

## Testing

Following the existing pattern (Node built-in test runner; pure helpers + CLI smoke):

- `test/jira-update.test.js`:
  - Markdown→ADF for paragraphs, headings, lists, fenced code, inline code, bold/italic, links, mixed input.
  - ADF passthrough when `descriptionRepresentation: "adf"`.
  - Payload builders: `create`, `update-fields`, `transition` (with comment/fields), `link`.
  - Transition name → id resolution against a fixture `transitions.json`.
  - Link type resolution against a fixture.
  - CLI smoke: `--help`, missing required args per command, unknown command, dry-run produces audit files for a mocked Jira host.
- `test/skill-compliance.test.js`: extended to assert `jira-update` exists with valid SKILL.md frontmatter and the `bin` entry is registered in `package.json`.
- `test/vendor.test.js` (new): runs `npm run vendor`, asserts each `skills/*/scripts/atlassian-browser.js` matches `lib/atlassian-browser.js` byte-for-byte.

## Implementation order

1. Create `lib/atlassian-browser.js` by extracting from `skills/confluence-update/scripts/confluence-update.js` (most recent canonical version).
2. Add `npm run vendor` + `prepack` wiring; add `.gitignore` entries; add `test/vendor.test.js`.
3. Migrate the four existing skills to `require('./atlassian-browser')` and the new `createBrowserSession({ verifySession })` factory. Run `pnpm run ci` after each migration; all green before continuing.
4. Scaffold `skills/jira-update/`: SKILL.md, scripts/jira-update.js, scripts/lib.js, references/usage.md, references/distribution.md, package.json `bin` entry.
5. Implement `create` end-to-end (Markdown→ADF, payload builder, dry-run audit, `--apply` POST).
6. Implement `comment`, then `transition`, then `update-fields`, then `link`. Each step adds tests and runs the full suite.
7. Update `README.md` (skills table, CLI examples, env-vars section), `CHANGELOG.md`, `package.json` version → `0.10.0`.

## Open items deferred to v2 (out of scope here)

- `attachment` (upload/delete file attachments).
- `worklog` (time tracking entries).
- `delete-comment`.
- `replace-block` for agent-owned regions of issue descriptions (Markdown→ADF marker handling needed).
- Concurrency guard on `update-fields` if Jira ever exposes a clean version handle.
- Real LCS line diff in `confluence-update` dry-run output (separate spec).
