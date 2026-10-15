# Prose check: business

## Overview

Before tickets are posted, and before an existing ticket is changed, their text is checked against the writing rules a script can test. The check catches long dashes, code words in the fields developers and testers read first, and jargon, and gives a suggested fix for each. It never touches quoted evidence, code or links.

## User Roles

| Role | How they meet this feature |
|---|---|
| Business user | Sees the findings and the proposed fixes before approving anything |
| Skill (check-tickets, refine-ticket) | Runs the check and repeats it until clean |

## User Flows

| Step | What happens |
|---|---|
| 1 | A ticket set is drafted (step 5) or a refined ticket is proposed |
| 2 | Every title, body and acceptance criterion (the "done when" items) is scanned |
| 3 | Each finding names where it is, what is wrong and a fix |
| 4 | Fixes are applied and the check runs again until it is clean |

## Business Rules

| Rule | Detail |
|---|---|
| No long dashes anywhere | Em and en dashes are flagged across the whole text (TKT-1) |
| No code words in key fields | Checked in the title, sections headed "goal" or "what they need", every user story line (As a, I want, So that) wherever it sits in the body, and each acceptance criterion (TKT-2). A story line under one of those headings is reported once, not twice |
| Confirmed permission key allowed | A permission key the user confirmed, written in inline code as can verb noun (for example can view savings), is the one code span allowed in those fields; any other code span on the same line is still flagged (TKT-2) |
| No jargon anywhere | Terms from the shared deny-list are flagged with their plain replacement (TKT-3) |
| Evidence is never rewritten | Quoted lines, code blocks, inline code and links are skipped for dashes and jargon |
| Clean means ready | The check passes only with zero findings |
| Not checked by script | Sentence length (TKT-4) and invented facts (TKT-5) are left to judgment |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Step 5 check, or refining a ticket | A list of findings; nothing is written to the tracker |

## Error States

| State | Handling |
|---|---|
| Findings exist | Ticket set is not ready; fixes proposed (AC-8) |
| The input file cannot be read | The check reports an error and does not pass |
| Scripts cannot run | The same rules are applied by hand from the skill's checklist |

## Glossary

| Term | Meaning |
|---|---|
| Finding | One rule break, with its location and a suggested fix |
| Code word | A file path, identifier, function call, backtick code, web request verb, database term or library name |
| Story line | A line that starts with a bold As a, I want or So that |
| Permission key | The confirmed can verb noun name of who may use a capability |

Sources: shared/scripts/check_prose.py, shared/references/writing-rules.md, shared/references/user-stories.md
