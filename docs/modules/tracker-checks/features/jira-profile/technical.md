# Jira tracker profile: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `shared/references/tracker-profiles-jira.md` | Action list, known tool-name variants, custom-field rule, step 0 setup list, label rule |

The map lists the flat file `shared/references/tracker-profiles-jira.md` as owned. A second profile, `shared/references/tracker-profiles-github.md`, now covers GitHub Issues as an export-only tracker (section 9); it is declared by `get-connected` and `post-tickets`. Other trackers stay export-only in v1 and would each add one `tracker-profiles-<name>.md` file.

## Data Contracts

Actions the skills resolve against the connector's tool list:

| Action | Used for |
|---|---|
| create issue | Epics and stories |
| edit issue | Field changes; the additional-fields parent route |
| add comment | Comments (refine append-as-comment route) |
| create link | Dependency links |
| list link types | Link types with inward and outward wording |
| read issue | Read-back |
| search | Duplicate search; reconciling a lost reply |
| list fields for an issue type | Finding custom field IDs |

Known variants: create link is `createIssueLink` or `createJiraIssueLink`; list link types is `getIssueLinkTypes` or `listJiraIssueLinkTypes`.

Setup block keys named here: `size_field_id`, `sprint_field_id`. Other setup items (project key, issue types, epic and story type, required fields per type, link types, create-action availability) are listed without key names; the record shape is owned by discovery-record.

Labels: `paqad-discovery` plus the run ID in lowercase (for example `dr-20261005-7k2q`).

## Script Interfaces

None: this feature is instruction-only. The action-to-tool resolution for links is implemented in `skills/post-tickets/scripts/plan_posting.py` (ticket-posting).

## State Management

None: stateless. Resolved values are stored in the discovery record `setup` block by `get-connected`.

## Error Codes

None.

## Dependencies

| Kind | Detail |
|---|---|
| Declared by skills (`build/skills.yml`) | `get-connected`, `post-tickets`, `refine-ticket`, `size-work`, `plan-sprint` import `references/tracker-profiles-jira.md` |
| In `dist/` | `skills/<name>/references/tracker-profiles-jira.md` (flat, one level under `references/`) |
| Host capability | A tracker connector with write tools for the target project (C5, O16, U-13 per host); every host verdict on links, parent and sprint field is still `pending` in `hosts/*.md` |

## Configuration

None.

## Testing Entry Points

| File | Tests |
|---|---|
| `tests/scripts/test_posting.py` | `LinkActionTest.test_both_link_action_names_resolve` (AC-18) |

Eval scenario using a tracker: `s1.yml` `ac-2` (no create permission, export offered; declarative). Manual host checks: U-3, U-9, U-14, U-15, U-16, U-17 rows in `hosts/claude.md`, `hosts/chatgpt.md`, `hosts/codex.md`.
