# Check the ticket set: business

## Overview

Before anything reaches the tracker, the plugin checks the drafted epics and tickets four ways: the wording, the structure, whether similar issues already exist in the tracker, and a set of judgment questions a reviewer would ask. Problems are fixed and checked again. The result is a readiness verdict, passed or open, and posting only goes ahead once readiness is passed.

## User Roles

| Role | What they do here |
|---|---|
| Business user (idea author) | Sees any similar existing issues and decides for each ticket: new, duplicate, or extend the existing issue. Reviews proposed wording fixes. |
| The plugin | Runs the checks, proposes fixes, re-checks, and records readiness. |
| Tracker | Only searched, never changed, during this step. |

## User Flows

1. After drafting, the plugin says a one-line status, for example "Step 5 of 6: checking the tickets."
2. Wording check: flags dashes, code words in the key sections and jargon, each with the line and a suggested fix. Fixes are applied and the check runs again until clean.
3. Structure check: confirms the set is complete and consistent (see rules below).
4. Duplicate search: searches the tracker by key phrases for each epic and ticket and shows the matches before anything is posted. The user decides what each ticket is through the host's choice prompt.
5. Judgment checks: each ticket serves its epic's goal; a developer would know when it is done; nothing in "what exists today" is contradicted by the documents; the split is sensible; similar issues have been shown; each ticket is a real user story (a specific person, a capability, a real outcome, API or UI, a UI ticket depending on its API ticket, a confirmed permission key with an allowed and a refused criterion).
6. Readiness is recorded as passed, or left open with one plain line per open item and what would close it.

## Business Rules

| Rule | Detail |
|---|---|
| No dashes | Em and en dashes are flagged anywhere in ticket text. |
| No code words | Paths, function or class names, code-style identifiers, web request verbs, database terms and library names are flagged in the title, goal, the story lines (As a, I want, So that) and the acceptance criteria. A permission key confirmed with the user, such as can view savings, is allowed. |
| No jargon | Words on the shared deny-list are flagged with their plain replacement. |
| Quotes are safe | Quoted text, code blocks and links are never rewritten. |
| Complete structure | Every epic has at least one ticket; every ticket has exactly one epic; 2 to 8 acceptance criteria; no repeated titles; every dependency points to a real ticket; no dependency loop. |
| Up to date | The set must match its saved fingerprint; any edit needs the fingerprint refreshed. |
| Duplicates are the user's call | Matches are shown before posting; the user decides new, duplicate or extend. |
| Honest readiness | Passed only when the automatic (or by-hand) checks are clean and the judgment checks hold; otherwise open. |

## Triggers and Side Effects

| Trigger | Effect |
|---|---|
| Drafting finishes in step 5 | Checks run and the readiness result is recorded. |
| Readiness is passed | The journey may move to step 6, posting. |
| The ticket set is changed afterwards | The readiness result becomes out of date and must be redone. |

The duplicate search reads the tracker only. Nothing is created or edited.

## Error States

| Situation | What happens |
|---|---|
| A check finds problems | Fixes are proposed; readiness stays open until they are resolved. |
| No tool can run scripts | The same checks are done by hand from a checklist; the readiness result is the same. |
| The set was edited without refreshing its fingerprint | Flagged as out of date; it must be refreshed before readiness can pass. |
| A vague acceptance criterion (for example "works well") | Flagged as not checkable and rewritten into something observable. |

## Glossary

| Term | Meaning |
|---|---|
| Readiness | The verdict that the ticket set is fit to post: passed or open. |
| Deny-list | The shared list of jargon words, each with a plain replacement. |
| Fingerprint (digest) | A code computed from the ticket set's content; it changes whenever the content changes. |
| Duplicate search | A read-only search of the tracker for issues similar to the new ones. |
| Acceptance criterion | A Given, When, Then condition a ticket must meet; stored where "done when" was. |

Sources: skills/check-tickets/SKILL.md, skills/check-tickets/references/review-checklist.md, shared/references/user-stories.md, REQUIREMENTS.md sections 8.2, 8.4 and 8.5.
