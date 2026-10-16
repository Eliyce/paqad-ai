# Turn an answer into an idea: business

## Overview

When an answer shows a real problem or opportunity, the plugin adds one short line on what it means and offers to shape a change. If the user accepts, the idea journey starts with the answer and its sources already in place, so the user is not asked the same things again.

## User Roles

| Role | What they do here |
|---|---|
| Business user | Reads the answer, decides whether to turn it into an idea |

## User Flows

| Step | What happens |
|---|---|
| 1 | The plugin answers a question (see Answer a question with sources). |
| 2 | If the answer points to a gap, it adds one line, for example "So pausing needs a support call today. Want to shape a change?" |
| 3 | The user says yes ("turn this into an idea"). |
| 4 | The idea journey starts. The answer and its sources fill the starting points for "your idea" and "what exists today". |
| 5 | The journey shows a one-line status and carries on without re-asking what was already answered (AC-23). |

## Business Rules

| Rule | Detail |
|---|---|
| Only when it matters | The consultant line is added only when the answer reveals a real problem or opportunity; otherwise nothing is added (ASK-5, CON-9, TALK-2). |
| One line | The note and the offer stay to one short line. |
| Offer last | The offer comes after the Sources line and the source line, never above them, through the choice prompt when the host has one (TALK-13). |
| Offer, not push | The user decides; nothing starts without a yes. |
| Nothing asked twice | The answer and sources seed the idea and today steps (ASK-6). The project chosen for the question holds for the rest of the conversation, so the journey does not ask which project again (GRD-3). |
| Template gaps too | When a needed section is template text, the plugin may offer to shape an idea instead of guessing (AC-22). |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Answer reveals a gap or idea | One-line consultant note and offer |
| User accepts | The idea journey begins, with its record seeded from the answer; no tracker change |

## Error States

| Situation | What happens |
|---|---|
| User declines or ignores the offer | Nothing changes; the conversation continues as questions |
| Nothing readable at all | No answer is given, so there is nothing to hand over. Any repository with readable code is answered at the code-only level or better, so its answer can be handed over |

## Glossary

| Term | Meaning |
|---|---|
| Idea journey | The guided steps that shape an idea into a decided outcome, usually tickets |
| Idea block, today block | The parts of the journey's record that hold the idea and what exists today |

Sources: skills/ask-project/SKILL.md, REQUIREMENTS.md section 4B
