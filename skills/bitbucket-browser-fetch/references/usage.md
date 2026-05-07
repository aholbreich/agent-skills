# Bitbucket Browser Fetch Usage

## Why Browser Fetch?

Bitbucket Cloud organizations often rely on Atlassian SSO. Browser fetch avoids pasted secrets by:

1. Launching/reusing a dedicated Chromium-compatible browser profile.
2. Letting the user complete normal Bitbucket/Atlassian login in the browser.
3. Reading Bitbucket cookies through local Chrome DevTools.
4. Verifying access to the requested Bitbucket project.
5. Calling Bitbucket's browser/internal API to list project repositories.

The official `api.bitbucket.org/2.0` API does not reliably accept browser cookies, so this skill uses the same internal API the Bitbucket UI uses for project repository lists.

## Common Command

```bash
scripts/bitbucket-browser-fetch.js \
  'https://bitbucket.org/myneva/workspace/projects/SWI' \
  --raw-dir ./raw
```

## Output Files

For `https://bitbucket.org/myneva/workspace/projects/SWI`:

```text
raw/bitbucket/myneva/projects/SWI/
├── repositories.json              # normalized machine-readable inventory
├── repositories.md                # human/LLM-friendly table
├── clone-ssh.txt                  # one SSH git clone URL per line
├── clone-https.txt                # one HTTPS git clone URL per line
├── clone-ssh.sh                   # safe helper script; not executed automatically
├── bitbucket-browser-fetch-run.json
└── pages/
    ├── repositories-page-1.json   # raw Bitbucket internal API responses
    └── repositories-page-2.json
```

## Agent Checkout Workflow

The skill does not clone automatically. After reviewing the output, agents can selectively clone with normal Git SSH credentials:

```bash
mkdir -p repos
while read -r url; do
  name="$(basename "$url" .git)"
  [ -d "repos/$name/.git" ] && echo "SKIP $name" && continue
  git clone "$url" "repos/$name"
done < raw/bitbucket/myneva/projects/SWI/clone-ssh.txt
```

Or run the generated helper script after review:

```bash
raw/bitbucket/myneva/projects/SWI/clone-ssh.sh repos
```

## Environment Variables

| Variable | Meaning |
|---|---|
| `BITBUCKET_RAW_DIR` | Default output raw directory |
| `BITBUCKET_CHROME_DEBUG_PORT` | Chrome DevTools port; overrides `ATLASSIAN_CHROME_DEBUG_PORT` |
| `ATLASSIAN_CHROME_DEBUG_PORT` | Shared DevTools port for Atlassian browser tools |
| `BITBUCKET_CHROME_PROFILE` | Dedicated Chrome profile dir; overrides `ATLASSIAN_CHROME_PROFILE` |
| `ATLASSIAN_CHROME_PROFILE` | Shared browser profile dir for Atlassian tools |
| `BITBUCKET_FETCH_WAIT_SEC` | Wait timeout, default `900` |
| `BITBUCKET_PAGELEN` | Internal API page size, default `100` |
| `CHROME` / `CHROMIUM` | Browser executable path override |

## Troubleshooting

### Project not found / no access

Complete Bitbucket/Atlassian login in the opened browser and confirm you can view the project URL manually.

### Official API returns empty but UI shows repositories

Expected in SSO/browser-cookie mode. This skill intentionally uses Bitbucket's browser/internal API.

### Git clone fails

Browser authentication and Git authentication are separate. Configure SSH keys or Git credentials for Bitbucket before cloning.
