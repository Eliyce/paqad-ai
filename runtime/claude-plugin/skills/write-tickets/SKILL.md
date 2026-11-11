---
name: write-tickets
description: "Chat and Claude Code: Step 5 of the discover journey: drafts epics and user-story tickets with Given/When/Then acceptance criteria into the ticket set and a preview. Also redrafts the ticket set and its preview when the person changes the draft during the journey, for example moving a group of tickets to a different epic or a new one, and asks for approval again. Use when the journey directs it to step 5 or back to it for a redraft, not directly."
compatibility: "claude.ai chat, Cowork or Claude Code; reads project docs and code through a connector, uploaded files or the open folder"
---

# write-tickets

How to talk: follow `references/voice.md`. Short, answer first, plain business words, no narration,
one short sources line. Those rules win.

## When this runs

Directed by the discover journey, not started directly: the drafting half of step 5, after the
decisions block settles. Say the status on entry ("Step 5 of 6: drafting the tickets.").

## What it does

Turn the record into a ticket set, only from the idea, today, playback, decisions and assumptions
blocks, never fresh invention. Story rules: `references/user-stories.md`.

1. Draft each epic using `assets/epic-template.md`: an outcome title, a one-sentence goal, why it
   matters in the author's words, what exists today (including the unknowns), in scope and not in
   scope, how we will know it worked, the decisions made, the open questions, and the sources.
   Follow the recorded `epic_choice`, one choice per epic in order. For an existing epic draft no
   epic text: the title is the live title as read, never rewritten, and each ticket under it
   carries the goal, the why and the scope it needs in its own body.
2. Before drafting tickets, settle the intake (`references/user-stories.md`): the Implementation
   Target per ticket (API or UI; both means an API ticket then a UI ticket that depends on it), the
   Module Name from the today block, and any permission key, confirmed with the user through the
   host's choice prompt before any ticket is written. Record a confirmed key as a decision.
3. Draft each ticket under exactly one epic using `assets/ticket-template.md`, as a user story: a
   specific role, a capability in plain words and a real outcome, then Given/When/Then acceptance
   criteria. Walk the silent self-audit and never show it; split a ticket needing more than 8
   criteria. Follow the two-trailing-spaces line-break rule. A piece with no user value after one
   honest try is not written: say so in one line and offer, through the choice prompt, to leave it
   out or name the user pain.
4. Follow the writing rules in `references/writing-rules.md` and the shared deny-list in
   `references/plain-language.md`: no em or en dash, no code words in the title, the story lines or the
   acceptance criteria (a confirmed permission key in inline code is the one allowed code span), no
   jargon from the deny-list, short sentences, and no invented numbers, dates or names. Quotes, code
   and URLs are safe from the later prose check.
5. Write the set into `ticket-set.json` in the shape fixed by `assets/ticket-set.schema.json`:
   run_id, revision, digest, tracker, and epics each holding their tickets. Each acceptance
   criterion becomes one done_when item. Carry the run label and the item reference (for example
   `DR-20261005-7K2Q / E1-T2`) into each Sources section. An existing epic keeps its `E<n>` ref
   and gets `existing_key`, the live title, an empty `body_markdown` and an empty `labels` list.
   A redraft keeps the recorded choice and does not ask again.
6. Show a compact chat preview, one row per epic and ticket (ref, target, title), with the full text
   in a downloadable preview file (in chat only if asked or no file can be made). The ticket set is
   the source of truth. Each group shows where it goes: a new epic, or an existing epic on its own
   row marked "not changed". The user may move one group; that changes the recorded choice, so
   show the preview again and ask for approval again.

## If the checks cannot run

No script; draft by hand with this checklist:

- Every new epic has all nine template sections, with "Not in scope" present even if it says
  nothing is excluded yet, and no success number invented. An existing epic has none of them: only
  its key, its live title, an empty body and no labels, and each ticket under it carries the goal,
  the why and the scope in its own body, with the real key and title on its Epic line.
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

`ticket-set.json` (per `assets/ticket-set.schema.json`) and a compact preview. The ticket_set_ref
block points to this file and its digest; check-tickets and post-tickets work from it.
