# Ticket writing rules: business

## Overview

Every epic and ticket the plugin drafts or improves follows the same five writing rules. They keep tickets readable by a developer and a tester without asking the author, and they stop the plugin from inventing facts. Drafting follows them from the start; the prose check enforces the ones a script can test.

## User Roles

| Role | How they meet this feature |
|---|---|
| Business user | Approves tickets written to these rules |
| Developer and tester | Read the title, goal, "what they need" and "done when" directly |

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
| No code words in the key fields | No file paths, function or class names, identifiers, backtick code, web request verbs, database terms or library names in title, goal, "what they need" and "done when"; module plain names are allowed (TKT-2) |
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
| Key fields | Title, goal, "what they need and why" and "done when" |
| Done when | The 2 to 8 checkable statements a tester can verify |
| Sources line | The bottom section naming documents, the run ID and the item reference |

Sources: shared/references/writing-rules.md
