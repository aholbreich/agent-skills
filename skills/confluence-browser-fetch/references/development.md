# Confluence Browser Fetch Architecture and Development

## Design goals

- Reuse the existing Confluence REST acquisition behavior across Cloud and Server/Data Center.
- Keep SSO credentials inside a dedicated browser profile.
- Never use CDP cookie/storage APIs in the Confluence fetch path.
- Support native Chromium and managed Windows Chrome/Edge from WSL.
- Keep each installed skill directory self-contained.
- Enforce exact-origin, read-only, bounded requests.

## Components

Source-of-truth shared files:

```text
lib/browser-context.js
lib/launch-windows-browser.ps1
```

Vendored copies used by the standalone skill:

```text
skills/confluence-browser-fetch/scripts/browser-context.js
skills/confluence-browser-fetch/scripts/launch-windows-browser.ps1
```

Confluence-specific files:

```text
confluence-browser-fetch.js   CLI and acquisition orchestration
confluence-deployment.js      origin/context/API/link construction
lib.js                        path, version, filename, and size helpers
```

Run after changing shared files:

```bash
npm run vendor
npm run vendor:check
```

`bin/vendor.js` has an explicit source/consumer manifest. Do not restore the old behavior that copied every shared browser library into every skill.

## Browser-context request lifecycle

```text
CLI input
  → infer exact origin and Confluence context path
  → launch/reuse dedicated browser
  → user completes SSO
  → find exact-origin page target
  → Runtime.evaluate(fetch(GET, credentials: include))
  → validate final origin
  → enforce response bound
  → return response data to Node
```

`BrowserContextTransport` exposes:

- `text(url, options)`;
- `json(url, options)`;
- `buffer(url, { maxBytes, ... })`;
- `close()`.

It deliberately does not expose arbitrary methods, request bodies, cookie operations, storage operations, or cross-origin requests.

## Binary transfer

A bounded browser fetch reads response chunks until completion or `maxBytes + 1`. On success, the bytes are held under a random ephemeral key in the page's JavaScript global and returned to Node as fixed-size base64 chunks. Cleanup runs in `finally`.

This avoids one unbounded CDP response and gives both declared-size and observed-size enforcement. It is still intended for modest evidence attachments, not bulk artifact transfer.

## Deployment adapter

`inferConfluenceDeployment()` returns:

```js
{
  origin,
  contextPath,
  appBase,
  apiBase,
  site,
  api(path),
  web(path)
}
```

Rules:

- explicit `--context-path` wins;
- a path on `--site` is treated as the context;
- classic page URL markers expose the prefix before `/pages`, `/display`, or `/spaces`;
- `*.atlassian.net` defaults to `/wiki`;
- otherwise the default is root;
- all input and generated absolute URLs must retain the exact origin.

Do not add tenant-specific hosts or paths to this module.

## Browser backends

### Native

Uses the existing dedicated native Atlassian profile and port defaults for compatibility. Browser auto-detection covers common Linux/macOS Chromium variants.

### Windows/WSL

Node invokes the vendored PowerShell launcher through `powershell.exe`. WSL paths are converted with `wslpath -w` before passing `-File`.

The launcher supports `Ensure`, `Status`, and `Stop`. It checks:

- supported Chrome/Edge installation;
- loopback DevTools port;
- browser process command line;
- expected profile path;
- dedicated-profile marker;
- conflicting browser ownership of the port.

The marker is a safety signal, not a security boundary. Never reuse a normal user browser profile.

## Testing

Fast focused tests:

```bash
node --test test/browser-context.test.js test/confluence-browser-fetch.test.js test/vendor.test.js
```

Full gate:

```bash
npm run ci
```

Important fixture/test categories:

- Cloud `/wiki`, root Server/DC, and custom contexts;
- classic `viewpage.action` and `releaseview.action` page IDs;
- direct-child (`child/page`) versus recursive descendant (`descendant/page`) scope;
- exact-origin rejection;
- GET + `credentials: include` expression shape;
- bounded binary chunking and cleanup;
- absence of cookie/storage extraction in the new fetch path;
- explicit vendoring and drift checks;
- CLI validation without browser launch.

PowerShell behavior should be manually checked from WSL without launching a browser:

```bash
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
  -File "$(wslpath -w skills/confluence-browser-fetch/scripts/launch-windows-browser.ps1)" \
  -Mode Status -Browser chrome -Port 9445
```

## Private end-to-end validation

Use a private page only for local runtime validation:

```bash
confluence-browser-fetch '<PRIVATE-URL>' \
  --browser-backend windows-wsl \
  --no-attachments \
  --raw-dir /tmp/confluence-validation
```

Verify generic properties only:

- authenticated session probe succeeds;
- expected page ID is returned;
- storage/view bodies are non-empty;
- context path is correct;
- output contains no credential values.

Then delete the validation output. Never create a committed private HTML/JSON fixture. Public tests must use `example.com` data.

## Security review checklist

Before release:

```bash
rg -n 'Network\.getCookies|Storage\.getCookies|document\.cookie|localStorage|sessionStorage|Cookie:' \
  lib/browser-context.js \
  skills/confluence-browser-fetch/scripts/browser-context.js \
  skills/confluence-browser-fetch/scripts/confluence-browser-fetch.js
```

Expected: no matches.

Also review:

- origin validation before every request;
- final response origin validation;
- finite binary limits;
- no write verbs;
- no secrets/private hosts in tests or docs;
- `npm pack --dry-run` contents;
- `git status` for raw/profile artifacts.

## Legacy boundary

`lib/atlassian-browser.js` remains temporarily for Jira, Bitbucket, and update skills. It uses the older cookie-replay model. Do not import it into `confluence-browser-fetch` again.

Future migrations should reuse `browser-context.js`, but write skills require a separate design for CSRF, confirmation, dry-run/audit guarantees, and concurrency controls. Do not enable non-GET methods in this fetch transport merely to support writes.
