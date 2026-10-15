# Refine an existing ticket: business

## Overview

People can point the plugin at one or more tickets that already exist in the tracker and ask for them to be tidied up ("this ticket is vague", "clean up ABC-12", "this is really three tickets"). The plugin reads each ticket in full, says what is wrong and why, and proposes a before and after for each field it wants to change. Nothing is written until the user says "apply it" for that exact proposal. It never deletes or closes a ticket, never overwrites someone else's newer edit without asking, and never flattens a rich description.

## User Roles

| Role | What they do here |
|---|---|
| Business user (product owner, analyst) | Names the tickets, reviews the diagnosis and the proposed changes, says "apply it". |
| Original ticket author | Their meaning and clear wording are kept. |
| Other tracker users | May edit the same ticket meanwhile; their edits trigger a conflict stop. |
| The plugin | Reads, diagnoses, proposes, checks for conflicts, applies and reads back. |

## User Flows

1. The user names one or more tickets. This skill can be started directly.
2. For each ticket, the plugin reads every field (summary, description, type, parent, labels, links, status, assignee, sprint, size) and saves a snapshot with the last-updated time.
3. It names the problems in plain words, each with evidence: no acceptance criteria ("done when"), untestable outcomes, jargon, no "not included", a contradiction with the project documents, too big, a missing parent or dependency.
4. It proposes a before and after per changed field. For a ticket that is too big, it proposes new tickets under the same epic, linked to the original, which is kept. Each new ticket is a user story like a drafted one: a specific person, a capability in plain words, a real outcome and Given, When, Then acceptance criteria.
5. The user says "apply it" for that exact proposal.
6. Just before writing, the plugin re-reads the ticket. If someone changed it since the snapshot, it stops, shows what changed and asks.
7. It applies the change, reads each ticket back, and reports the links and any difference.

## Business Rules

| Rule | Detail |
|---|---|
| Read first | Every ticket is read in full and snapshotted before any proposal. |
| Diagnose with evidence | Each finding names where it comes from. |
| What the documents prove | Missing or template project notes are never a finding that a feature is missing, in any wording; the area is not documented. A contradiction that rests on a status line in a document is said as what the docs say, for the exact thing that line names only. When whether the area exists matters to a finding and the plugin can reach the code, it checks that area's code and labels the finding "the code suggests", at most one such line per area (GRD-8, GRD-9, GRD-11). |
| Keep the intent | The ticket is improved, never turned into something else. A bigger or different piece of work is sent to the idea journey instead. |
| Limited fields | Only summary, description, labels, parent, links, and new child tickets on a split. Status, assignee, priority, sprint and size change only if the user asks for that exact change. |
| Explicit approval | Only "apply it" for the exact proposal shown. "Looks good" is not approval. Any edit to the proposal voids it. |
| Conflict stop | A newer edit in the tracker since the snapshot stops the write until the user decides. |
| Rich content kept | If the description holds images, panels, mentions or merged-cell tables, the improved text is added as a marked new section or a comment, never as a replacement, and the user is told which. |
| Split keeps the original | New tickets sit under the same epic and link to the original, which is not deleted. |
| Never delete, never close | No ticket is deleted or moved through workflow states. |
| Honest report | Partial results are reported as partial. |

## Triggers and Side Effects

| Trigger | Effect |
|---|---|
| User points at existing tickets to improve | A refine run starts with a snapshot of each ticket. |
| User says "apply it" | The approved fields are written; on a split, new linked tickets are created. |
| The snapshot is retaken | Any proposal built on the old snapshot is out of date and must be redone. |
| The proposal is edited after approval | Approval is void; a new preview and "apply it" are needed. |

## Error States

| Situation | What happens |
|---|---|
| Ticket edited by someone else after the snapshot | Conflict shown; nothing written until the user decides. |
| Proposal touches a field outside the allowed list | Refused and reported, not applied. |
| Description is rich | Improved text is appended as a section or comment instead of replacing it. |
| Read-back differs from the approved change | Difference reported; result is partial. |
| No tool can run scripts | The same steps are followed by hand from a checklist. |

## Glossary

| Term | Meaning |
|---|---|
| Snapshot | The saved copy of a ticket, with its last-updated time, taken before any change. |
| Change set | The list of proposed field changes, each with a before and after. |
| Rich content | Description content plain text cannot carry: images, panels, mentions, merged-cell tables. |
| Split | Breaking one large ticket into new linked tickets under the same epic. |
| Conflict | Someone changed the ticket in the tracker after the snapshot was taken. |

Sources: skills/refine-ticket/SKILL.md, skills/refine-ticket/references/refine-procedure.md, skills/refine-ticket/references/rich-content.md, shared/references/paqad-docs-map.md, REQUIREMENTS.md section 4C.
