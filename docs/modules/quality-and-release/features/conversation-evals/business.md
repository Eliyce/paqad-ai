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
| Properties, not wording | For example answer-first, no-narration, single sources line, template section flagged, nothing posted without approval |
| One scenario per conversation-shape acceptance scenario | 25 for the idea journey and questions, 4 for refining, sizing and sprint planning |
| Script-proven scenarios are not duplicated | Those live in the unit tests |
| Fiction only | The fixture project and tracker are invented |

The fixture project holds five modules (returns, subscriptions, orders, members, data export) plus a sixth registry entry (loyalty) with no module folder, including documents that mix real and template sections. The fixture tracker holds tickets shaped for specific scenarios (a vague ticket, one with an image and a panel, one that should be split, sized finished tickets, an unready candidate) and a sprint board with three past sprints.

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
