# GitHub Issues tracker profile

A tracker profile names the actions a skill needs and lets the skill pick the connector tool that
performs each action from whatever the connector exposes. This profile covers GitHub Issues.
"GitHub" is the name of the tracker, not a host.

GitHub Issues is export only in this plugin. The host GitHub connectors are read only, so there is
no write action to post, edit, comment or link through the connector. A write capable profile is
added only once a write capable connector exists in every supported host, which is not the case
today. So for GitHub the plugin drafts and checks the work the same way as for any tracker, then
hands it over through the export fallback rather than posting it.

## Actions

Each row is an action a skill may need. For GitHub, the write actions are not available through the
host connector, so the skill does not try to resolve a tool for them. It uses the export fallback
instead.

| Action | Availability for GitHub |
|---|---|
| create issue | Not available through the host connector. Use the export fallback. |
| edit issue | Not available through the host connector. |
| add comment | Not available through the host connector. |
| create link | Not available through the host connector. Dependencies are written as task-list references in the body. |
| list link types | Not applicable. |
| read issue | Available only when a read connector is present, for a duplicate search or a read back. |
| search | Available only when a read connector is present, for a duplicate search. |
| list fields for an issue type | Not applicable. GitHub Issues has no per issue-type field schema to read. |

## Model mapping

GitHub Issues does not use the same shape as the ticket set, so map the parts before export:

| Ticket set part | GitHub Issues |
|---|---|
| epic | GitHub has no native epic. Map an epic to a tracking issue, or to a milestone, and keep the choice in the export notes. |
| ticket | A GitHub issue. |
| parent epic | Kept as a reference in the issue body, since there is no epic link. |
| dependency | A task-list reference in the body, for example "depends on the import issue", since there is no link action. |

## Export

Posting to GitHub goes through the post-tickets export fallback (PUB-8). Produce the Markdown export
as the primary form, because GitHub has no native bulk CSV import for issues: the user creates each
issue from the Markdown, one issue per section. The CSV export stays available for a third-party
importer the user may run themselves. The plugin ships no integration code and holds no credentials,
so creating the issues in GitHub is the user's own step.

## Labels (PUB-4)

Every item carries the shared label `paqad-discovery` and the run label (the run ID in lowercase,
for example `dr-20261005-7k2q`) as GitHub labels, and its item reference in the Sources section.
GitHub labels allow hyphens, so both labels apply unchanged.

## Setup to read at step 0 (PUB-1)

There is no usable create action for GitHub through the host connector, so step 0 records the tracker
kind as GitHub, notes it is export only, and stops before drafting is wasted only if the user asked
to post to GitHub directly. Otherwise it proceeds and offers the export at hand off. Tell the user
once that GitHub items are produced as an export they create themselves, not posted by the plugin.
