# Draft the ticket set: business

## Overview

Once every open choice about an idea is settled, the plugin writes the epics and tickets for it. It works only from what the run already holds (the idea, what exists today, the playback, the decisions and the accepted assumptions) and never invents new facts. Each epic is one outcome; each ticket sits under exactly one epic and is written as a user story: a specific person, what they want in plain words, the real outcome for them, and Given, When, Then acceptance criteria a tester can check. The result is one ticket set that the checking and posting steps use, plus a short preview the user can read in chat.

## User Roles

| Role | What they do here |
|---|---|
| Business user (idea author) | Reads the preview, asks for the full text if wanted, and corrects anything that reads wrong. |
| The plugin | Drafts the epics and tickets from the record using fixed templates and writing rules. |
| Tester or developer (later reader) | Relies on each ticket's acceptance criteria being checkable without asking the author. |

## User Flows

1. The journey reaches step 5 after the decisions are settled. The plugin says a one-line status, for example "Step 5 of 6: drafting the tickets."
2. It drafts each epic with nine sections: an outcome title, a one-sentence goal, why it matters, what exists today (including unknowns), in scope and not in scope, how we will know it worked, decisions made, open questions, and sources.
3. Before any ticket is written, it settles what is missing, one short question at a time through the host's choice prompt: whether each piece is system work (API) or screen work (UI), the plain area name, and, for a capability only some people may use, the permission key (for example can view savings), which the user confirms or replaces.
4. It drafts each ticket under one epic as a user story: a short title, the target (API or UI), the area name, the epic, the As a, I want, So that lines, 2 to 8 Given, When, Then acceptance criteria, what it depends on, what exists today, what is not included, open questions, and sources. A piece that needs both system and screen work becomes two tickets, the system one first, the screen one depending on it.
5. It silently checks each ticket against a fixed list of concerns (the happy path, a failure, permission allowed and refused, a repeated action, linked records, limits, unusual inputs, two people at once, and empty, loading and error screens) and adds any missing criterion. The list is never shown. A ticket that would need more than 8 criteria is split.
6. A piece with no real user value after one honest try is not written: the plugin says so in one line and offers, through the choice prompt, to leave it out or to name the user pain it removes.
7. It saves the set as the single source of truth and shows a compact preview, one row per epic and ticket with its reference, target and title, with the full text in a downloadable preview file.
8. The checking step then takes over.

## Business Rules

| Rule | Detail |
|---|---|
| Nothing invented | No made-up numbers, dates, names or commitments. A missing success number reads "To be measured after release". |
| Plain words | No em or en dash, no code words in the title, goal, story lines or acceptance criteria (a confirmed permission key is the one allowed code span), no jargon from the shared deny-list, short sentences. |
| Real user value | Every ticket names a specific person (never developer, platform or system) and a real outcome; an I want is a capability, not how it is built. |
| Testable outcomes | Every ticket has 2 to 8 Given, When, Then acceptance criteria a tester can check alone; none names another ticket. |
| API then UI | A piece needing both is an API ticket then a UI ticket that depends on it; only the half that applies is written. |
| Confirmed permissions | A gated capability carries the key the user confirmed, with one criterion for a person who has it and one for a person who does not; a key is never invented. |
| Readable layout | Every line inside a block except its last ends with two trailing spaces so it shows line by line. |
| Edges stated | "Not in scope" (epics) and "Not included" (tickets) are always present, even when nothing is excluded yet. |
| Unknowns named | What the documents could not confirm is listed as unknown, never filled with a guess. |
| Traceable | Each Sources section carries the document paths, the run ID and the item reference (for example a run ID followed by an epic and ticket reference). |
| Titles | Under about 10 words and at most 80 characters; the preview shows the reference then the title, for example E1-T1: title. |
| Depends on | Always present; reads "none" when there is nothing. |
| Assignee | Left empty unless the author names a person. |
| Preview | Compact in chat; full text in chat only if the user asks or no file can be made. |

## Triggers and Side Effects

| Trigger | Effect |
|---|---|
| The journey enters step 5 after the decisions are settled | A new ticket set and preview are produced. |
| The ticket set is saved | The record points to it with its digest; any earlier readiness result and posting work become out of date. |
| The user goes back and changes an earlier answer | The ticket set is marked out of date and must be redrafted. |

Nothing is written to the tracker by this feature.

## Error States

| Situation | What happens |
|---|---|
| No tool can run scripts | Not a blocker: this feature has no script and drafts by hand with a fixed checklist. |
| No file can be made | The full text goes into chat instead of a preview file. |
| A fact the ticket needs is unknown | It is written as an unknown or an open question with a suggested owner, not guessed. |
| The work has no user value (for example renaming a table) | No story is written; the plugin says so in one line and offers to leave it out or name the user pain. |

## Glossary

| Term | Meaning |
|---|---|
| Epic | One business outcome that groups related tickets. |
| Ticket | One piece of work under exactly one epic. |
| User story | A ticket written as As a (a specific person), I want (a capability), So that (the real outcome). |
| Acceptance criterion | A Given, When, Then condition the work must meet to be accepted; the older name is "done when". |
| Implementation Target | Whether a ticket is system work (API) or screen work (UI). |
| Permission key | The plain can verb noun name of who may use a capability, confirmed with the user. |
| Ticket set | The single saved list of all epics and tickets for a run; it is what gets checked and posted. |
| Item reference | The label that ties a ticket back to the run, such as a run ID followed by an epic and ticket number. |

Sources: skills/write-tickets/SKILL.md, skills/write-tickets/assets/epic-template.md, skills/write-tickets/assets/ticket-template.md, shared/references/user-stories.md, REQUIREMENTS.md sections 8.1 to 8.4 (TKT-6).
