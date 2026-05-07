---
name: bitbucket-browser-fetch
description: Fetch Bitbucket Cloud project repository inventory through an authenticated browser session when API tokens/app passwords are unavailable, especially with Atlassian SSO. Use to list repositories in a Bitbucket workspace project and produce JSON, Markdown, SSH clone URL lists, HTTPS clone URL lists, and a safe clone helper script.
license: MIT
compatibility: Agent Skills standard. Tested with Pi; installable into Claude Code, Codex, OpenClaw/generic .agents skills directories. Requires Node.js 22+ with built-in fetch/WebSocket and a Chromium-compatible browser with remote debugging (Chrome, Chromium, Brave, Edge, or Vivaldi). No npm dependencies.
---

# Bitbucket Browser Fetch

Use this skill when a user wants all repositories in a Bitbucket Cloud project inventoried through an authenticated browser session. This is useful when Bitbucket app passwords/API tokens are unavailable or inconvenient because the organization uses Atlassian SSO.

The script opens/reuses Chrome with a dedicated profile, lets the user complete Bitbucket login once, extracts Bitbucket cookies via Chrome DevTools, verifies project access, and fetches the repository list using Bitbucket's browser/internal API.

## Safety

- Never ask the user to paste Bitbucket cookies, app passwords, or API tokens into chat.
- The skill is read-only and does not clone repositories itself.
- It writes clone URL lists and a helper script; review before executing any clone script.
- Treat repository names/URLs as potentially confidential.

## Script

```bash
scripts/bitbucket-browser-fetch.js <PROJECT_URL> [options]
```

Important options:

```bash
--workspace NAME   override workspace parsed from URL
--project KEY      override project key parsed from URL
--raw-dir DIR      output raw directory
--pagelen N        internal API page size, default 100
--wait SEC         SSO/session wait timeout
--port PORT        Chrome DevTools port
--profile-dir DIR  Chrome profile dir
```

## Example

```bash
scripts/bitbucket-browser-fetch.js \
  'https://bitbucket.org/myneva/workspace/projects/SWI' \
  --raw-dir ./raw
```

## Output

```text
raw/bitbucket/<workspace>/projects/<project-key>/
├── repositories.json
├── repositories.md
├── clone-ssh.txt
├── clone-https.txt
├── clone-ssh.sh
├── bitbucket-browser-fetch-run.json
└── pages/
    └── repositories-page-1.json
```

Agents should normally use `repositories.json` for metadata and `clone-ssh.txt` for selective checkout with normal Git SSH credentials.

## References

- [Usage reference](references/usage.md)
- [Distribution guide](references/distribution.md)
