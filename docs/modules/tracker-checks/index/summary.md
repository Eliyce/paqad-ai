# Tracker Write Checks

Keeps tracker writes safe and readable: checks ticket prose before anything is posted, compares what the tracker holds with what was approved, and describes how to work with a Jira project without hard-coding tool names.

| | |
|---|---|
| Layer | shared-foundation |
| Confidence | medium |
| Entry skill | none (shared) |
| Depends on | [discovery-record](../../discovery-record/index/summary.md) |
| Used by | [ticket-drafting](../../ticket-drafting/index/summary.md), [ticket-posting](../../ticket-posting/index/summary.md), [ticket-refinement](../../ticket-refinement/index/summary.md), [work-sizing](../../work-sizing/index/summary.md), [sprint-planning](../../sprint-planning/index/summary.md) |

## Features

| Feature | What it does | Docs |
|---|---|---|
| Prose check | Flags em and en dashes, code words in the key fields, and deny-list jargon, each with a suggested fix | [business](../features/prose-check/business.md), [technical](../features/prose-check/technical.md) |
| Read back what was written | Compares created issues with the approved ticket set after normalisation and reports match, partial or mismatch | [business](../features/read-back-check/business.md), [technical](../features/read-back-check/technical.md) |
| Jira tracker profile | Names the tracker actions a skill needs, the known tool-name variants, the custom fields to discover, and the labels every issue carries | [business](../features/jira-profile/business.md), [technical](../features/jira-profile/technical.md) |

## Sources

| Path | Role |
|---|---|
| `shared/scripts/check_prose.py` | TKT-1 to TKT-3 prose lint |
| `shared/scripts/check_readback.py` | PUB-6 read-back comparison |
| `shared/references/tracker-profiles/jira.md` | Jira actions, variants, custom fields, setup and labels |
| `tests/scripts/test_tickets.py` | Prose check tests (`CheckProseTest`) |
| `tests/scripts/test_posting.py` | Read-back tests (`ReadbackTest`) and link-action variant test (`LinkActionTest`) |

Both scripts import `canonical.py` from [discovery-record](../../discovery-record/index/summary.md); `fit_sprint.py` (sprint-planning) imports `check_readback.norm_ref`.

## Requirements

- TKT-1, TKT-2, TKT-3: prose rules checked by script; quoted text, code blocks and URLs skipped (section 8.4).
- PUB-1: discover tracker setup, name actions not tools, resolve custom fields.
- PUB-3: links only through the link action.
- PUB-4: shared label, run label and item reference on every created issue.
- PUB-6: read-back after posting; partial reported as partial.
- Section 8.5: prose and read-back checks.
- PLG-5, PLG-6, PLG-9: standard library scripts, checklist fallback in each skill, held once under `shared/`.
- AC-8, AC-13, AC-18: prose block and fix, ordered posting with matching read-back, both link tool names.
