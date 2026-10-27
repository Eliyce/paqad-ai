---
name: write-tickets
description: "Chat and Claude Code: Step 5 drafting of the discover idea journey. Builds the epics and tickets from the discovery record into a canonical ticket set file and a readable, compact preview. Follows the epic and ticket templates and the writing rules so every ticket reads in plain business words, each ticket is a user story (As a, I want, So that) with 2 to 8 Given, When, Then acceptance criteria, and nothing is invented. Produces ticket-set.json and the preview that check-tickets and post-tickets build on. Runs when the discover journey directs it; not started directly."
compatibility: "claude.ai chat, Cowork or Claude Code; reads project docs and code through a connector, uploaded files or the open folder"
---

# write-tickets

How to talk: before replying, follow `references/voice.md`. Short by default, lead with the
answer, plain business words, no narration, one short sources line at the end. Those rules win
over everything else here.

## When this runs

Runs when the discover journey directs it; not started directly. It is the drafting half
of step 5, and runs after the decisions block is settled in step 4. Say the one-line status when
you enter it, for example "Step 5 of 6: drafting the tickets."

## What it does

Turn the record into a ticket set. Work only from the idea, today, playback, decisions and
assumptions blocks, not from fresh invention. The story rules are in `references/user-stories.md`.

1. Draft each epic using `assets/epic-template.md`: an outcome title, a one-sentence goal, why it
   matters in the author's words, what exists today (including the unknowns), in scope and not in
   scope, how we will know it worked, the decisions made, the open questions, and the sources.
2. Before drafting tickets, settle the intake (`references/user-stories.md`): the Implementation
   Target per ticket (API or UI; both means an API ticket then a UI ticket that depends on it), the
   Module Name from the today block, and any permission key, confirmed with the user through the
   host's choice prompt before any ticket is written. Record a confirmed key as a decision.
3. Draft each ticket under exactly one epic using `assets/ticket-template.md`, as a user story: a
   specific role, a capability in plain words and a real outcome, then Given/When/Then acceptance
   criteria. Walk the silent self-audit and never show it; split a ticket that would need more
   than 8 criteria. Follow the two-trailing-spaces line-break rule. A piece with no user value after one honest
   try is not written: say so in one line and offer, through the choice prompt, to leave it out or
   name the user pain.
4. Follow the writing rules in `references/writing-rules.md` and the shared deny-list in
   `plain-language.md`: no em or en dash, no code words in the title, the story lines or the
   acceptance criteria (a confirmed permission key in inline code is the one allowed code span), no
   jargon from the deny-list, short sentences, and no invented numbers, dates or names. The later
   prose check skips quotes, code and URLs, so quoted evidence is safe.
5. Write the set into `ticket-set.json` in the shape fixed by `assets/ticket-set.schema.json`:
   run_id, revision, digest, tracker, and epics each holding their tickets. Each acceptance
   criterion becomes one done_when item. Carry the run label and the item reference (for example
   `DR-20261005-7K2Q / E1-T2`) into each Sources section.
6. Show a compact preview in chat, one row per epic and ticket with its ref, target (API or UI)
   and title, and put the full text into a downloadable preview file. Put the full text in chat
   only if the user asks or no file can be made. The ticket set, not the chat preview, is the
   source of truth.

## If the checks cannot run

This skill carries no script. Draft by hand with this checklist:

- Every epic has all nine template sections, with "Not in scope" present even if it says nothing
  is excluded yet, and no success number invented.
- Every ticket has exactly one parent epic, an Implementation Target of API or UI, a Module Name,
  and the As a, I want, So that block with a specific role and a real outcome.
- Every ticket has 2 to 8 Given/When/Then acceptance criteria a tester could check without asking
  the author; a gated ticket has a positive and a negative permission criterion with the confirmed
  key; a UI ticket that needs an API ticket depends on it.
- Lines inside each block except the last end with two trailing spaces; Depends on reads "none"
  when empty.
- No em or en dash, no code words in the title, story lines or acceptance criteria, no deny-list
  jargon, short sentences, and no invented numbers, dates, names or commitments.
- The sources section of each epic and ticket carries the document paths, the run ID and the item
  reference.

## Output

Produces `ticket-set.json` (the canonical set defined by `assets/ticket-set.schema.json`) and a
compact readable preview. The ticket_set_ref block of the discovery record points to this file and
its digest; check-tickets and post-tickets work from it.
