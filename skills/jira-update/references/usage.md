# jira-update — Usage Reference

This skill writes to Jira Cloud through an authenticated browser session.

## Commands

### `create`

Creates a new issue. Input is a JSON manifest with optional Markdown description.

Example manifest (`new-bug.json`):

```json
{
  "project": "PROJ",
  "issueType": "Bug",
  "summary": "Login fails on Safari 17",
  "description": "## Steps to reproduce\n\n1. Open the login page\n2. ...",
  "descriptionRepresentation": "markdown",
  "labels": ["bug", "browser"],
  "assignee": "accountId:5b10ac8d82e05b22cc7d4ef5",
  "priority": "High",
  "fields": { "components": [{"name": "frontend"}] }
}
```

Top-level convenience keys map to standard Jira fields. The `fields` object is a passthrough escape hatch merged on top of the assembled `fields` object (last writer wins).

`descriptionRepresentation` accepts `markdown` (default; converted by the skill) or `adf` (in which case `description` must be a valid ADF document).

### `comment`

Adds a comment. Default representation is `markdown`.

```bash
jira-update comment PROJ-123 --file reply.md
```

### `transition`

Moves an issue through a workflow.

```bash
jira-update transition PROJ-123 --to "In Progress"
jira-update transition PROJ-123 --to-id 31 --comment-file done.md
jira-update transition PROJ-123 --to "Done" --field resolution=Fixed
```

### `update-fields`

Partial field update.

```bash
jira-update update-fields PROJ-123 --file changes.json
```

`changes.json`:

```json
{ "fields": { "summary": "...", "labels": ["x", "y"] } }
```

No concurrency guard. Re-fetch with `jira-browser-fetch` first if drift matters.

### `link`

Links two issues.

```bash
jira-update link PROJ-123 --to PROJ-456 --type blocks
```

## Audit dir

Every command writes to `raw/jira-updates/<command>-<key|new>-<timestamp>/`. Always review before running with `--apply`.
