# Ticket Refinement

Improves existing tracker tickets field by field and writes only an approved change set, guarding against conflicting edits and lost rich content.

| | |
|---|---|
| Layer | user-facing |
| Confidence | high |
| Entry skill | `refine-ticket` |
| Depends on | [discovery-record](../../discovery-record/index/summary.md), [tracker-checks](../../tracker-checks/index/summary.md), [conversation-standards](../../conversation-standards/index/summary.md) |
| Used by | none (no module in the map depends on it) |

## Features

| Feature | What it does | Docs |
|---|---|---|
| Refine an existing ticket | Snapshots, diagnoses with evidence, proposes a digest-bound before and after change set, checks for conflicts, guards rich descriptions, applies on "apply it" and reads back. | [business](../features/refine-a-ticket/business.md), [technical](../features/refine-a-ticket/technical.md) |

## Sources

| Path | Role |
|---|---|
| `skills/refine-ticket/SKILL.md` | Entry skill instructions and by-hand checklist |
| `skills/refine-ticket/references/refine-procedure.md` | Ordered refine procedure with the EDT rules |
| `skills/refine-ticket/references/rich-content.md` | Rich-content detection and the append rule |
| `skills/refine-ticket/scripts/diff_ticket.py` | Change-set builder with field limit, conflict and rich-content guards |

## Requirements

- EDT-1: read each ticket in full and snapshot it with its last-updated time.
- EDT-2: diagnose before changing, with evidence per finding.
- EDT-3: preserve the author's intent; redirect larger work to `product-discovery`.
- EDT-4: field-by-field change limited to summary, description, labels, parent, links and split children.
- EDT-5: apply only on an explicit "apply it" bound to the change-set digest.
- EDT-6: re-read before writing and stop on a conflicting edit.
- EDT-7: never replace a rich description with plain text (U-16).
- EDT-8: split into new linked tickets under the same epic; keep the original.
- EDT-9: never delete or close a ticket.
- EDT-10: read back and report differences.
- REC-1, REC-7: refine mode record blocks `existing` and `changes`; digest-bound approval.
- AC-30 to AC-34.
