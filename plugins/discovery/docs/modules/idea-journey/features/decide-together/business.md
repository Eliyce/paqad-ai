# Settle open choices: business

## Overview

Step 4 of the idea journey ("Decide"). The plugin settles the choices left open after shaping, one at a time. Each choice comes with a recommendation and two or three options, asked through the host's choice prompt. Every decision is recorded with who decided and why. When the user does not know, a sensible default is offered and recorded as an assumption, never as a decision. It runs only when the journey directs it.

## User Roles

| Role | What they do here |
|---|---|
| Business user | Makes each decision, or accepts a default |
| Named decider | If the user names someone else as the decider, that person is recorded |

## User Flows

| Step | What happens |
|---|---|
| 1 | One-line status: "Step 4 of 6: deciding the open choices." |
| 2 | The plugin takes the first open choice, with a recommendation and two or three short options in the choice prompt (a short list in the reply only when the host has none). |
| 3 | The user picks; the decision is recorded with an id, the question, the choice, who decided and why. |
| 4 | If the user says "I don't know", a default is offered and recorded as an assumption. |
| 5 | Repeat until no open choice is left. |

## Business Rules

| Rule | Detail |
|---|---|
| One at a time | Choices are never batched. |
| Bring a recommendation | Each choice has a recommendation and two or three options in the choice prompt, recommended one first and marked, one clause of why (CON-1, TALK-8). The chosen outcome is also confirmed through the choice prompt. |
| Decision only on choice | A recommendation is not a decision until the user accepts it. |
| Assumptions kept apart | A default is labelled an assumption and stored separately; it reaches tickets as an open question or stated assumption, never a commitment (TKT-5, AC-29). |
| Settled stays settled | Revisited only for new evidence (CON-3). |
| Nothing invented | No number, date, name or scope the user did not accept. |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Step 3 finishes | Fills the decisions and assumptions parts of the record; no tracker access |

## Error States

| Situation | What happens |
|---|---|
| User does not know | Default offered and stored as an assumption |
| User revisits a settled choice without new facts | The earlier choice is kept |

## Glossary

| Term | Meaning |
|---|---|
| Decision | A choice the user made, with who and why |
| Assumption | A default the user accepted when they did not know |
| Outcome | The recommended ending (build, experiment, already exists, process change, defer, stop), required before step 4 can finish |

Sources: skills/decide-together/SKILL.md, skills/decide-together/references/decision-template.md, skills/product-discovery/references/journey.md
