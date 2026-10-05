---
name: write-tickets
description: Step 5 drafting of the product-discovery idea journey. Builds the epics and tickets from the discovery record into a canonical ticket set file and a readable, compact preview. Follows the epic and ticket templates and the writing rules so every ticket reads in plain business words, each ticket has 2 to 8 checkable "done when" statements, and nothing is invented. Produces ticket-set.json and the preview that check-tickets and post-tickets build on. Runs when the product-discovery journey directs it; not started directly.
---

# write-tickets

How to talk: before replying, follow `references/voice.md`. Short by default, lead with the
answer, plain business words, no narration, one short sources line at the end. Those rules win
over everything else here.

## When this runs

Runs when the product-discovery journey directs it; not started directly. It is the drafting half
of step 5, and runs after the decisions block is settled in step 4. Say the one-line status when
you enter it, for example "Step 5 of 6: drafting the tickets."

## What it does

Turn the record into a ticket set. Work only from the idea, today, playback, decisions and
assumptions blocks, not from fresh invention.

1. Draft each epic using `assets/epic-template.md`: an outcome title, a one-sentence goal, why it
   matters in the author's words, what exists today (including the unknowns), in scope and not in
   scope, how we will know it worked, the decisions made, the open questions, and the sources.
2. Draft each ticket under exactly one epic using `assets/ticket-template.md`: a verb-plus-outcome
   title, who it is for, what they need and why, what exists today for this ticket, 2 to 8
   checkable "done when" statements, what is not included, what it depends on, any open questions,
   and the sources.
3. Follow the writing rules in `references/writing-rules.md` and the shared deny-list in
   `plain-language.md`: no em or en dash, no code words in the title, goal, what-they-need or
   done-when, no jargon from the deny-list, short sentences, and no invented numbers, dates or
   names. The later prose check skips quotes, code and URLs, so quoted evidence is safe.
4. Write the set into `ticket-set.json` in the shape fixed by `assets/ticket-set.schema.json`:
   run_id, revision, digest, tracker, and epics each holding their tickets. Carry the run label
   and the item reference (for example `DR-20261005-7K2Q / E1-T2`) into each Sources section.
5. Show a compact preview in chat, one row per epic and ticket, and put the full text into a
   downloadable preview file. Put the full text in chat only if the user asks or no file can be
   made. The ticket set, not the chat preview, is the source of truth.

## If the checks cannot run

This skill carries no script. Draft by hand with this checklist:

- Every epic has all nine template sections, with "Not in scope" present even if it says nothing
  is excluded yet, and no success number invented.
- Every ticket has exactly one parent epic and all its template sections.
- Every ticket's "done when" has 2 to 8 statements a tester could check without asking the author.
- No em or en dash, no code words in title, goal, what-they-need or done-when, no deny-list
  jargon, short sentences, and no invented numbers, dates, names or commitments.
- The sources section of each epic and ticket carries the document paths, the run ID and the item
  reference.

## Output

Produces `ticket-set.json` (the canonical set defined by `assets/ticket-set.schema.json`) and a
compact readable preview. The ticket_set_ref block of the discovery record points to this file and
its digest; check-tickets and post-tickets work from it.
