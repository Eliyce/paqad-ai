# Idea Journey

Guides an idea or problem through steps 0 to 4 (get connected, your idea, what exists today, shape it, decide), keeps the discovery record, and handles step order, one-line status, resume and going back for the whole journey.

| | |
|---|---|
| Layer | user-facing |
| Confidence | high |
| Entry skill | `product-discovery` (the other five skills are journey steps) |
| Depends on | [discovery-record](../../discovery-record/index/summary.md), [project-grounding](../../project-grounding/index/summary.md), [conversation-standards](../../conversation-standards/index/summary.md), [ticket-drafting](../../ticket-drafting/index/summary.md), [ticket-posting](../../ticket-posting/index/summary.md) |
| Used by | None in the module map |

## Features

| Feature | What it does | Docs |
|---|---|---|
| Step order, status, resume and going back | Runs steps 0 to 6 in order against record exit conditions, shows one-line status, answers side questions without moving, resumes from a downloaded record, and redoes only the dependent work on going back | [business](../features/coordinate-journey/business.md), [technical](../features/coordinate-journey/technical.md) |
| Check documents and tracker are ready | Step 0: onboarded check, tracker write access, reads tracker setup into `setup`, warns once about run labels | [business](../features/get-connected/business.md), [technical](../features/get-connected/technical.md) |
| Understand the idea | Step 1: goal, who benefits, success, constraints, one question at a time, into `idea` | [business](../features/understand-the-idea/business.md), [technical](../features/understand-the-idea/technical.md) |
| Find what exists today | Step 2: related areas from the project documents, real vs template per section, sourced, into `today` | [business](../features/ground-in-the-project/business.md), [technical](../features/ground-in-the-project/technical.md) |
| Shape the idea with options and risks | Step 3: goal-first playback, expert lenses, options, smaller first step, recommendation, into `playback` | [business](../features/shape-the-idea/business.md), [technical](../features/shape-the-idea/technical.md) |
| Settle open choices | Step 4: one choice at a time, into `decisions` and `assumptions` | [business](../features/decide-together/business.md), [technical](../features/decide-together/technical.md) |

## Sources

| Path | Role |
|---|---|
| `skills/product-discovery/SKILL.md` | Entry skill: step table, record commands, going back, side questions, resume, checklist fallback |
| `skills/product-discovery/references/journey.md` | Per-step purpose and exit conditions, go-back invalidation map |
| `skills/get-connected/SKILL.md`, `references/connect-repository.md`, `references/connect-tracker.md` | Step 0 procedure |
| `skills/get-connected/scripts/check_onboarded.py` | GRD-1 onboarded check script |
| `skills/understand-idea/SKILL.md`, `references/question-bank.md`, `references/success-prompts.md` | Step 1 procedure |
| `skills/ground-in-project/SKILL.md` | Step 2 procedure |
| `skills/shape-idea/SKILL.md`, `references/playback-template.md`, `references/expert-lenses.md`, `references/challenge-guide.md` | Step 3 procedure |
| `skills/decide-together/SKILL.md`, `references/decision-template.md` | Step 4 procedure |

`skills/product-discovery/assets/record-template.md` sits in this module's folder but is assigned to discovery-record in the module map.

## Requirements

| ID | Line |
|---|---|
| Section 4 | Six-step journey with plain step names; going back at any time |
| REC-2 to REC-6 | Record as a file, exit conditions, expected revision and stale map, resume, no secrets |
| CON-1 to CON-9 | Consultant stance: recommendation plus choices, extract first, challenge, lenses, smaller first step, suggest not invent, outcomes |
| GRD-1 to GRD-7 | Onboarded check, reading order, by-capability access, template detection, sources, glossary, untrusted content |
| PUB-1, PUB-4, PUB-7, PUB-8 | Step 0 tracker setup discovery, run-label warning, write-access check, export fallback |
| TALK-8, TALK-12 | Short choices, one-line status |
| PLG-6, PLG-7, PLG-8 | Checklist fallback, capability wording, step skills run only when the journey directs them |
| AC-1 to AC-5, AC-7, AC-15, AC-19, AC-23 to AC-29, AC-48 | Acceptance scenarios exercised by this module |
