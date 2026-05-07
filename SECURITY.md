# Security Policy

## Read this before installing or running

These skills are local automation tools. They can fetch potentially sensitive Jira and Confluence data into your filesystem.

## Browser authentication model

The Jira and Confluence fetchers:

1. launch or reuse Chrome/Chromium with a dedicated local profile,
2. let you complete normal Atlassian SSO in the browser,
3. read Atlassian cookies through the local Chrome DevTools protocol,
4. verify those cookies represent an authenticated Jira/Confluence REST session,
5. call Atlassian REST endpoints with those cookies.

They do **not** require you to paste API tokens or cookies into chat.

## Important precautions

- Do not paste Atlassian cookies, API tokens, passwords, or session headers into prompts, issues, logs, or commits.
- Treat everything under `raw/` as confidential unless you know it is public.
- Do not commit fetched Jira/Confluence exports or attachments to a public repository.
- Review generated `attachments.json` manifests before sharing; they may contain private URLs and filenames.
- Chrome remote debugging is configured for `127.0.0.1`; do not expose it to a network interface.
- Use dedicated browser profiles for fetch automation.
- The default attachment download cap is `5mb`; skipped large attachments are still referenced in `attachments.json`.

## Attachment size limits

Both fetchers support:

```bash
--max-attachment-size 5mb
--max-attachment-size 500kb
--max-attachment-size unlimited
```

Large skipped files remain documented in `attachments.json` with filename, URL, size, and skip reason.

## Reporting security issues

If you find a vulnerability, please open a private security advisory on GitHub if available, or contact the repository owner directly. Do not publish exploit details before there is a fix or mitigation.
