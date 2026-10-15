# Conversation eval scenarios: business

## Overview

Much of what makes the plugin good cannot be proven by a unit test: whether replies are short, lead with the answer, never narrate, flag template text, ask one question at a time, and never post without approval. These scenarios describe such conversations and the properties each reply must have, against a fictional project and a fictional tracker. They are written but not yet run, so these qualities are currently unverified.

## User Roles

| Role | Interest |
|---|---|
| Delivery lead or product owner | Evidence that the conversation rules hold, once the scenarios run |
| Contributor | Adds a scenario for each new conversation-shape acceptance scenario |
| Eval runner (planned) | Runs each scenario against the built plugin |

## User Flows

| Step | What happens (once wired up) |
|---|---|
| 1 | The built plugin is loaded with the fixture project and a fake tracker |
| 2 | Each scenario's user message is sent to its entry skill |
| 3 | The reply is checked for properties, never exact wording |
| 4 | Each scenario runs at least three times; a property must hold every time (CI-12) |

## Business Rules

| Rule | Detail |
|---|---|
| Properties, not wording | For example answer-first, no-narration, single sources line, template section flagged, nothing posted without approval, an area with no notes called not documented and never said or implied to be missing, in any wording |
| One scenario per conversation-shape acceptance scenario | 25 for the idea journey and questions, 4 for refining, sizing and sprint planning, 8 for choosing the project and working at the docs-and-code level, 11 for areas with no notes, status lines in the notes, requirements documents, business notes that state rules and the automatic code check, and 8 for generic mode (the three evidence levels, the one source line, the only stop, the informational nudge and a code-only size) |
| Script-proven scenarios are not duplicated | Those live in the unit tests |
| Fiction only | The fixture project and tracker are invented |

The fixture project holds five modules (returns, subscriptions, orders, members, data export) plus two more registry entries (loyalty and referrals) with no module folder, including documents that mix real and template sections. Loyalty and referrals both have invented code but no notes, and no document gives referrals a status. The members notes carry one out of date line saying the account page lists loyalty points as an entry marked soon, and one account rule worded as something that must hold. An invented requirements document sits at the top of the project; its only hint is that it is a baseline for technical design. A bundled outside code package describes transferring points, inside a folder the code check never reads. The fixture tracker holds tickets shaped for specific scenarios (a vague ticket, one with an image and a panel, one that should be split, sized finished tickets, an unready candidate, one that wrongly says loyalty is not built yet) and a sprint board with three past sprints. A second fixture, the code-only repository, holds real code (bookings and reminders, with models, actions, pages, routes and tests) and no paqad docs, so generic-mode scenarios can be answered from the code by names at the code-only level.

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Nightly or manual verify run | Today only prints placeholders; nothing is evaluated |

## Error States

| State | Meaning |
|---|---|
| Not run in CI | TALK and CON rules have no automated evidence yet (planned for slice S3) |
| No runner on ChatGPT or Codex | The structural half of the ChatGPT and Codex parity check (same journey, same answer shape, same ticket-set) runs offline today in the unit suite; the live conversational parity on those hosts stays a manual, recorded run (AC-20, CI-12) |

## Glossary

| Term | Meaning |
|---|---|
| Scenario | A scripted user message, its entry skill, the fixture it reads and the properties expected |
| Property | A checkable behaviour of a reply, such as "the first line is the answer" |
| Fixture | Invented project documents and tracker data used only for testing |

Sources: tests/evals/
