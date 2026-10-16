# Discovery Record

Keeps the run's only memory: one revisioned JSON record per run, with staleness when the user goes back, step gating, and approvals bound to a content digest.

| | |
|---|---|
| Layer | shared-foundation |
| Confidence | medium |
| Entry skill | none (shared) |
| Depends on | none |
| Used by | [idea-journey](../../idea-journey/index/summary.md), [ticket-drafting](../../ticket-drafting/index/summary.md), [ticket-posting](../../ticket-posting/index/summary.md), [ticket-refinement](../../ticket-refinement/index/summary.md), [work-sizing](../../work-sizing/index/summary.md), [sprint-planning](../../sprint-planning/index/summary.md), [tracker-checks](../../tracker-checks/index/summary.md) |

## Features

| Feature | What it does | Docs |
|---|---|---|
| Create, update and advance the record | Creates the record, applies revision-checked patches with the go-back stale map, advances steps, binds approvals | [business](../features/record-lifecycle/business.md), [technical](../features/record-lifecycle/technical.md) |
| Approvals bound to content | Canonical JSON digest and shared helpers that tie every approval to the exact content approved | [business](../features/approval-digests/business.md), [technical](../features/approval-digests/technical.md) |
| Step readiness check | Read-only report of whether the current step's required blocks are present and not stale | [business](../features/step-readiness-check/business.md), [technical](../features/step-readiness-check/technical.md) |

## Sources

| Path | Role |
|---|---|
| `shared/scripts/record.py` | Record CLI and logic: `init`, `show`, `update`, `advance`, `approve` |
| `shared/scripts/check_record.py` | Read-only step readiness check |
| `shared/scripts/canonical.py` | Canonical digest, JSON load, timestamps, issue and result shapes |
| `skills/product-discovery/assets/record-template.md` | Human-readable record template and field notes |
| `tests/scripts/test_record.py`, `tests/scripts/test_check_record.py`, `tests/scripts/test_canonical.py` | Unit tests |

## Requirements

- REC-1: one record per run with fixed blocks and `run.mode` for refine, size and plan.
- REC-3: each step's exit condition is checked against the record.
- REC-4: expected-revision writes; going back stales dependents by a fixed map and keeps the rest.
- REC-2: the record is written silently, never offered or named (TALK-15).
- REC-5: resume from a resume file offered only when the user asks to stop and come back later (AC-15, AC-72).
- REC-6: no credentials, tokens or unneeded personal data (instruction only).
- REC-7: content digests for ticket set, change set and sprint plan; approvals bound to them.
- PUB-2, EDT-5, SPR-6: the approvals that REC-7 binds.
- AC-7, AC-15, AC-29, AC-34: record acceptance scenarios proven by the unit suite or evals.
