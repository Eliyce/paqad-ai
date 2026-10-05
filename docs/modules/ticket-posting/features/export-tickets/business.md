# Export tickets as CSV or Markdown: business

## Overview

The approved ticket set can always be downloaded instead of posted. This matters when the tracker cannot be written to: the connector is not switched on, it has no write tools, or the user cannot create issues in that project. The export is a CSV file shaped for the Jira importer, and the set can also be downloaded as Markdown.

## User Roles

| Role | What they do here |
|---|---|
| Business user | Downloads the file and imports it, or passes it to someone who can. |
| Tracker administrator (or anyone with the right permissions) | Runs the import in the tracker. |
| The plugin | Produces the file and explains the permissions needed to import it. |

## User Flows

1. The plugin finds that posting is not possible, or the user asks for a file.
2. It offers the export and produces a CSV (and Markdown on request) of the approved set.
3. It tells the user that importing needs the "Create work items" permission in the project and the "Make bulk changes" global permission.
4. The user or an administrator imports the CSV into the tracker.

## Business Rules

| Rule | Detail |
|---|---|
| Always available | The approved set can be exported at any point. |
| Fixed columns | Work type, Work item id, Summary, Description, Labels, Parent, in that order. |
| Epics first | Each epic row comes before its own ticket rows. |
| Parent link | Each ticket's Parent is its epic's Work item id. |
| Permissions explained | The user is told which tracker permissions the import needs. |

## Triggers and Side Effects

| Trigger | Effect |
|---|---|
| The tracker has no usable create action, or the user lacks create permission | Export is offered (also at step 0, before drafting is wasted). |
| The user asks for a download | A CSV (and Markdown) file is produced. |

Nothing is written to the tracker by this feature.

## Error States

| Situation | What happens |
|---|---|
| The ticket set file cannot be read | The export stops with an error; no file is produced. |
| No file can be made by the host | Not stated in the sources. |

## Glossary

| Term | Meaning |
|---|---|
| CSV | A spreadsheet-style text file the tracker's importer can read. |
| Work item id | The ticket's own reference in the set (for example E1 or E1-T2), used to connect tickets to their epic in the import. |
| Importer | The tracker's built-in tool for creating many issues from a file. |

Sources: skills/post-tickets/scripts/export_csv.py, skills/post-tickets/references/post-procedure.md, REQUIREMENTS.md PUB-7 and PUB-8.
