# Work Sizing

Suggests how big a ticket is from comparable finished work, labels it as advice for the team, and writes a size into the tracker only when the user says "set it".

| | |
|---|---|
| Layer | user-facing |
| Confidence | high |
| Entry skill | `size-work` |
| Depends on | [discovery-record](../../discovery-record/index/summary.md), [project-grounding](../../project-grounding/index/summary.md), [tracker-checks](../../tracker-checks/index/summary.md), [conversation-standards](../../conversation-standards/index/summary.md) |
| Used by | none in the module map (sprint-planning and ticket-refinement point users here in prose only) |

## Features

| Feature | What it does | Docs |
|---|---|---|
| Suggest a size | Finds the team scale, picks two to five comparable finished tickets, gives a labelled suggested size with drivers and confidence, and guards any write to the size field | [business](../features/suggest-a-size/business.md), [technical](../features/suggest-a-size/technical.md) |

## Sources

| Path | Role |
|---|---|
| `skills/size-work/SKILL.md` | Skill instructions, trigger description, checklist fallback, output block |
| `skills/size-work/references/sizing-guide.md` | Ordered sizing method (EST-1 to EST-7) |
| `skills/size-work/scripts/compare_sizes.py` | `suggest` and `set` subcommands |
| `tests/scripts/test_sizing.py` | Unit tests for `compare_sizes.py` |
| `tests/evals/scenarios/s1b.yml` (`ac-35`) | Conversation eval scenario |

## Requirements

- EST-1: find and remember the team sizing scale.
- EST-2: compare with two to five finished tickets, with links.
- EST-3: give a size or range, drivers, and a low, medium or high confidence; template docs lower it.
- EST-4: recommend a split when the work is big.
- EST-5: always labelled "suggested size", never a date or promise.
- EST-6: write to the size field only on "set it", never overwrite without "replace".
- EST-7: a size is never written as fact (keeps TKT-5).
- AC-35, AC-36, AC-37: sizing acceptance scenarios.
