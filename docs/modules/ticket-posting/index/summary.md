# Posting to the Tracker

Shows the final ticket set, takes an explicit go-ahead, creates the tickets in the tracker in a safe order, reads them back and reports, or exports them when posting is not possible.

| | |
|---|---|
| Layer | user-facing |
| Confidence | high |
| Entry skill | none (journey step) |
| Depends on | [tracker-checks](../../tracker-checks/index/summary.md), [discovery-record](../../discovery-record/index/summary.md), [conversation-standards](../../conversation-standards/index/summary.md) |
| Used by | [idea-journey](../../idea-journey/index/summary.md) |

## Features

| Feature | What it does | Docs |
|---|---|---|
| Post approved tickets | Recommends the outcome; for a build, takes a digest-bound "post it", plans epics then tickets then links then read-back, receipts each write and reconciles lost replies (step 6). | [business](../features/post-tickets/business.md), [technical](../features/post-tickets/technical.md) |
| Export tickets as CSV or Markdown | Produces a Jira importer CSV (and, by instruction, Markdown) of the approved set as a fallback. | [business](../features/export-tickets/business.md), [technical](../features/export-tickets/technical.md) |

## Sources

| Path | Role |
|---|---|
| `skills/post-tickets/SKILL.md` | Step 6 instructions and the by-hand fallback |
| `skills/post-tickets/references/post-procedure.md` | Ordered posting procedure, receipt states, lost-reply handling, export notes |
| `skills/post-tickets/scripts/plan_posting.py` | Ordered plan, approval guard, receipt lifecycle, reconcile |
| `skills/post-tickets/scripts/export_csv.py` | Jira importer CSV export |

## Requirements

- PUB-1: resolve connector actions from what the connector exposes (link action name variants).
- PUB-2: post only after an explicit "post it" bound to the ticket-set digest.
- PUB-3: epics, then tickets with parent, then links via the link action, then read-back.
- PUB-4: shared label `paqad-discovery`, run label and item reference on every created issue.
- PUB-5: in-flight, created, uncertain and not-applied receipts; reconcile a lost reply; never auto-retry or delete.
- PUB-6: read back and report partial results as partial.
- PUB-8: CSV and Markdown export fallback.
- CON-8: recommend the outcome; only a build posts a ticket set.
- REC-7, TALK-11: digest-bound approval; compact preview plus a full preview file.
- AC-2, AC-10, AC-11, AC-12, AC-13, AC-14, AC-18, AC-47.
