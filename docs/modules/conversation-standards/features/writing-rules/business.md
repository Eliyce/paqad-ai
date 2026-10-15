# Ticket writing rules: business

## Overview

Every epic and ticket the plugin drafts or improves follows the same five writing rules, and every ticket is written as a user story to a sixth (TKT-6): a specific person, what they want, the real outcome, and Given, When, Then acceptance criteria. They keep tickets readable by a developer and a tester without asking the author, and they stop the plugin from inventing facts. Drafting follows them from the start; the prose check enforces the ones a script can test.

## User Roles

| Role | How they meet this feature |
|---|---|
| Business user | Approves tickets written to these rules |
| Developer and tester | Read the title, goal, the user story (As a, I want, So that) and the acceptance criteria directly |

## User Flows

| Step | What happens |
|---|---|
| 1 | Tickets are drafted (step 5) or an existing ticket is reworded during refinement |
| 2 | The prose check flags dashes, code words and jargon with a suggested fix |
| 3 | Fixes are applied and the check runs again until clean |

## Business Rules

| Rule | Detail |
|---|---|
| No dashes used as dashes | No em dash or en dash anywhere in ticket text; use a hyphen or rewrite (TKT-1) |
| No code words in the key fields | No file paths, function or class names, identifiers, backtick code, web request verbs, database terms or library names in the title, goal, the user story lines (As a, I want, So that; "what they need" on an older ticket) and the acceptance criteria ("done when"); module plain names are allowed (TKT-2) |
| One allowed code span | A permission key confirmed with the user, written in inline code as can verb noun (for example can view savings), is allowed in the acceptance criteria; any other code is still flagged (TKT-2) |
| Written as a user story | A specific role, a capability in plain words, a real outcome, API or UI, 2 to 8 Given, When, Then criteria, a confirmed permission key with an allowed and a refused criterion when gated, and a refusal when there is no user value (TKT-6) |
| No jargon | Use the plain word from the shared deny-list (TKT-3) |
| Short sentences | Over about 30 words is a warning to tighten, not a failure (TKT-4) |
| Nothing invented | No made-up numbers, dates, names or commitments; a measure without a number reads "To be measured after release" (TKT-5) |
| Evidence is never rewritten | Quoted text, code and links are skipped by the check |
| Where evidence goes | Code names and paths belong in quotes or on the Sources line |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Drafting or refining a ticket | The text is written to these rules; nothing reaches the tracker until approved |

## Error States

| State | Handling |
|---|---|
| A draft breaks a rule | The check blocks it and proposes fixes; the fixed set passes (AC-8) |
| Scripts cannot run | The same rules are checked by hand from the skill's checklist |

## Glossary

| Term | Meaning |
|---|---|
| Key fields | Title, goal, the user story (As a, I want, So that, or "what they need and why" on an older ticket) and the acceptance criteria |
| Acceptance criteria | The 2 to 8 Given, When, Then conditions a tester can verify; held where "done when" was |
| Permission key | The confirmed can verb noun name of who may use a capability |
| Sources line | The bottom section naming documents, the run ID and the item reference |

Sources: shared/references/writing-rules.md, shared/references/user-stories.md
