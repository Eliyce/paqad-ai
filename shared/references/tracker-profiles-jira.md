# Jira tracker profile

A tracker profile names the actions a skill needs and lets the skill pick the connector tool that
performs each action from whatever the connector exposes. It hard-codes no tool name, because tool
names differ by connector version and by site (PUB-1). This profile covers Jira. "Jira" is the
name of the tracker, not a host.

## Actions

Each row is an action the skill needs. The skill finds the connector tool that performs it from
the connector's own tool list.

| Action | What it does |
|---|---|
| create issue | Create an epic or a story. |
| edit issue | Change fields on an existing issue (used for the additional-fields parent route). |
| add comment | Add a comment to an issue. |
| create link | Create a dependency link between two issues. |
| list link types | List the available link types and their inward and outward wording. |
| read issue | Read an issue's full fields for read-back. |
| search | Search issues, used for the duplicate search and for reconciling a lost reply. |
| list fields for an issue type | Read the full field list of an issue type, to find custom field IDs. |

## Known tool-name variants (PUB-1)

The same action is exposed under different tool names depending on the connector version. Resolve
the action to whichever name the connector actually offers:

| Action | Known names |
|---|---|
| create link | `createIssueLink` or `createJiraIssueLink` |
| list link types | `getIssueLinkTypes` or `listJiraIssueLinkTypes` |

Create links only with the link action. An issue edit that sets links has been reported to succeed
without creating them, so it is never used for links.

## Custom fields

The size field (story points or similar) and the sprint field are custom fields whose IDs differ
per site. Do not hard-code them. Find each from the issue type's full field list (the "list fields
for an issue type" action) and store the resolved IDs in the setup block as `size_field_id` and
`sprint_field_id`.

## Setup to read at step 0 (PUB-1)

Read and store in the setup block: the project key, the issue types, the epic type and story type,
the required fields per issue type, the link types, the resolved size and sprint field IDs, and
whether the connector offers a create action the user can use in the target project. If there is no
usable create action, stop before drafting and offer the export fallback.

## Labels (PUB-4)

Every created issue carries the shared label `paqad-discovery` and the run label (the run ID in
lowercase, for example `dr-20261005-7k2q`), and its item reference in the Sources section. Run
labels accumulate in the site's label list; tell the user this once at step 0.
