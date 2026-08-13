# Security Policy

## Read this before installing or running

These are local automation tools. Fetch skills can store sensitive Jira, Confluence, and Bitbucket data on your filesystem. Update skills can write to external systems only through their documented explicit apply modes.

## Browser authentication models

All browser tools launch or reuse a dedicated Chromium-compatible profile and let the user complete normal SSO/MFA. They never require a user to paste an API token, cookie, password, or session header into chat.

Two transports currently coexist.

### Confluence fetch: browser-context GET

`confluence-browser-fetch`:

1. selects a tab at the exact configured Confluence origin;
2. performs same-origin `GET` requests in that page context with browser credentials included;
3. validates that the final response remains at the exact origin;
4. returns bounded response data to Node.

It does **not** invoke CDP cookie/storage APIs, read `document.cookie`, construct Cookie headers, or return authentication material to Node. The transport exposes no write verbs.

### Legacy Jira/Bitbucket/update transport

The other four skills currently:

1. read site-scoped Atlassian cookies through local CDP;
2. verify the resulting authenticated product session;
3. call product REST endpoints with those cookies.

Cookies are kept in process memory and are not intentionally printed or persisted. This legacy behavior is narrower than copying a user's normal browser profile but has a larger credential boundary than the Confluence browser-context transport.

## CDP warning

Chrome DevTools Protocol is a powerful local browser-control interface. The cookie-free design of the Confluence fetcher is a property of its code—not a CDP sandbox. Another process that can reach the debugging endpoint may be able to inspect or control that dedicated browser.

Precautions:

- bind CDP only to `127.0.0.1`;
- never expose its port through firewall, port forwarding, SSH forwarding, containers, or a LAN interface;
- use only a dedicated automation profile, never an everyday browser profile;
- keep unrelated sites and tabs out of the dedicated browser;
- close the browser when automation is complete;
- keep the host and local user account secure.

## Windows/WSL backend

`confluence-browser-fetch` can launch Windows Chrome/Edge from WSL. The launcher:

- uses a profile under `%LOCALAPPDATA%\AgentSkillsBrowserProfiles\Atlassian` by default;
- writes a dedicated-profile marker;
- refuses a non-empty unmarked profile;
- verifies browser/profile ownership of the selected debugging port;
- binds CDP to Windows loopback;
- disables sync in the dedicated profile.

WSL must be able to reach Windows loopback. Do not solve connectivity problems by exposing CDP to a non-loopback interface.

The marker prevents common profile-selection mistakes but is not an authorization mechanism. Do not add it manually to an everyday browser profile.

## Data and output precautions

- Never paste cookies, API tokens, passwords, SAML assertions/requests, transient identity-provider URLs, or session headers into prompts, issues, logs, or commits.
- Treat everything under `raw/` as confidential unless independently known to be public.
- Do not commit fetched exports, update audit files, clone URL lists, attachments, or browser profiles to a public repository.
- Review `attachments.json`; filenames and URLs may reveal private information even when files were skipped.
- Opening captured HTML can load referenced remote resources. Prefer JSON/storage text for review in untrusted environments.
- Update skills are dry-run-first; review the generated audit directory before `--apply`.

## Attachment bounds

Fetchers default to `5mb`. Skipped files remain documented in their manifests.

```bash
--max-attachment-size 5mb
--max-attachment-size 500kb
```

`confluence-browser-fetch` additionally enforces a hard browser-transfer cap, default `100mb`, even if the legacy `unlimited` option is supplied. Configure a lower cap with:

```bash
CONFLUENCE_BROWSER_MAX_BINARY_SIZE=25mb
```

## Reporting security issues

Open a private GitHub security advisory if available, or contact the repository owner directly. Do not publish exploit details before a fix or mitigation exists.
