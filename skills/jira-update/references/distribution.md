# jira-update — Distribution

Bundled with the `@aholbreich/agent-skills` npm package and Pi skills bundle. Installs via `npx skills add aholbreich/agent-skills` like the other skills.

The skill folder is self-contained — `lib/atlassian-browser.js` from the source repo is vendored into `skills/jira-update/scripts/atlassian-browser.js` at pack time, so individual installations of just this skill work.
