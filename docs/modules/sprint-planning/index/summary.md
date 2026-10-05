# Sprint Planning

Proposes what fits the next sprint from capacity, priority and readiness, and puts only the approved tickets into that sprint.

| | |
|---|---|
| Layer | user-facing |
| Confidence | high |
| Entry skill | `plan-sprint` |
| Depends on | [discovery-record](../../discovery-record/index/summary.md), [tracker-checks](../../tracker-checks/index/summary.md), [conversation-standards](../../conversation-standards/index/summary.md) |
| Used by | none in the module map |

## Features

| Feature | What it does | Docs |
|---|---|---|
| Plan a sprint | Finds the target sprint and capacity, filters ready tickets, proposes goal, fit, stretch, left-out and risks, and on "apply it" sets the sprint field on the chosen tickets only | [business](../features/plan-a-sprint/business.md), [technical](../features/plan-a-sprint/technical.md) |

## Sources

| Path | Role |
|---|---|
| `skills/plan-sprint/SKILL.md` | Skill instructions, trigger description, checklist fallback, output block |
| `skills/plan-sprint/references/sprint-procedure.md` | Ordered procedure with the SPR limits and by-hand fallback |
| `skills/plan-sprint/scripts/fit_sprint.py` | `plan` and `apply` subcommands |
| `tests/scripts/test_sprint.py` | Unit tests for `fit_sprint.py` |
| `tests/evals/scenarios/s1b.yml` (`ac-38`) | Conversation eval scenario |

## Requirements

- SPR-1: find the target future sprint; never create one.
- SPR-2: capacity from the user or derived from the last three completed sprints, shown with its numbers.
- SPR-3: only ready tickets are candidates; unready ones are listed with what they need.
- SPR-4: propose goal, fitting tickets, stretch, left out with reasons, total against capacity, risks.
- SPR-5: consult, do not decide.
- SPR-6: apply only on "apply it", bound to the plan digest, then read back.
- SPR-7: never create, start, close, rename or reorder sprints or the backlog.
- U-14: by-hand list when the sprint field cannot be set.
- AC-38, AC-39, AC-40, AC-41: sprint acceptance scenarios.
