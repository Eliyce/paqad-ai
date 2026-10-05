# Draft the ticket set: business

## Overview

Once every open choice about an idea is settled, the plugin writes the epics and tickets for it. It works only from what the run already holds (the idea, what exists today, the playback, the decisions and the accepted assumptions) and never invents new facts. Each epic is one outcome; each ticket sits under exactly one epic. The result is one ticket set that the checking and posting steps use, plus a short preview the user can read in chat.

## User Roles

| Role | What they do here |
|---|---|
| Business user (idea author) | Reads the preview, asks for the full text if wanted, and corrects anything that reads wrong. |
| The plugin | Drafts the epics and tickets from the record using fixed templates and writing rules. |
| Tester or developer (later reader) | Relies on each ticket's "done when" statements being checkable without asking the author. |

## User Flows

1. The journey reaches step 5 after the decisions are settled. The plugin says a one-line status, for example "Step 5 of 6: drafting the tickets."
2. It drafts each epic with nine sections: an outcome title, a one-sentence goal, why it matters, what exists today (including unknowns), in scope and not in scope, how we will know it worked, decisions made, open questions, and sources.
3. It drafts each ticket under one epic: a verb-plus-outcome title, who it is for, what they need and why, what exists today, 2 to 8 "done when" statements, what is not included, what it depends on, open questions, and sources.
4. It saves the set as the single source of truth and shows a compact preview, one row per epic and ticket, with the full text in a downloadable preview file.
5. The checking step then takes over.

## Business Rules

| Rule | Detail |
|---|---|
| Nothing invented | No made-up numbers, dates, names or commitments. A missing success number reads "To be measured after release". |
| Plain words | No em or en dash, no code words in the title, goal, what-they-need or done-when, no jargon from the shared deny-list, short sentences. |
| Testable outcomes | Every ticket has 2 to 8 "done when" statements a tester can check alone. |
| Edges stated | "Not in scope" (epics) and "Not included" (tickets) are always present, even when nothing is excluded yet. |
| Unknowns named | What the documents could not confirm is listed as unknown, never filled with a guess. |
| Traceable | Each Sources section carries the document paths, the run ID and the item reference (for example a run ID followed by an epic and ticket reference). |
| Titles | At most 80 characters. |
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

## Glossary

| Term | Meaning |
|---|---|
| Epic | One business outcome that groups related tickets. |
| Ticket | One piece of work under exactly one epic. |
| Done when | A checkable statement that says when the ticket is finished. |
| Ticket set | The single saved list of all epics and tickets for a run; it is what gets checked and posted. |
| Item reference | The label that ties a ticket back to the run, such as a run ID followed by an epic and ticket number. |

Sources: skills/write-tickets/SKILL.md, skills/write-tickets/assets/epic-template.md, skills/write-tickets/assets/ticket-template.md, REQUIREMENTS.md sections 8.1 to 8.4.
