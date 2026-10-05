# Jira tracker profile: API

This feature has no API and no script. It is a shared reference document,
`shared/references/tracker-profiles/jira.md`, copied into each tracker-facing skill at build
time.

The profile names the tracker concepts the skills use by capability, not by endpoint: issue
types, required fields, link types, and the size and sprint field ids. The host's own Atlassian
connector provides the actual read and write operations; this plugin ships no integration code,
no credentials, and no endpoint definitions (D-4, PLG-2). A second tracker would be added as a
sibling profile under `shared/references/tracker-profiles/`, not as code here.
