---
name: check-tickets
description: "Chat and Claude Code: Step 5 of the discover journey: checks the drafted tickets for prose, structure and duplicates before posting. Use when discover runs step 5, not directly."
compatibility: "claude.ai chat, Cowork or Claude Code; reads project docs and code through a connector, uploaded files or the open folder"
---

# check-tickets

How to talk: follow `references/voice.md`. Short, answer first, plain business words, no narration,
one short sources line. Those rules win.

## When this runs

Directed by the discover journey, not started directly: the checking half of step 5, after
write-tickets drafts `ticket-set.json`. Say the status on entry ("Step 5 of 6: checking the tickets.").

## What it does

Check the drafted set three ways, then report readiness.

1. Prose check. If you have a tool that runs scripts, run `scripts/check_prose.py --ticket-set
   <ticket-set.json>`. It flags em and en dashes (TKT-1), code words in the title, goal, the story
   lines (As a, I want, So that) and the acceptance criteria (TKT-2; a confirmed permission key in
   inline code is allowed), and jargon from the shared `references/plain-language.md` deny-list
   (TKT-3), each with a line and a suggested fix. Quotes, code blocks and URLs are skipped. Fix and
   rerun until clean.
2. Structure check. Run `scripts/check_ticket_set.py --ticket-set <ticket-set.json>`. It validates
   the set against the schema, recomputes the digest, and fails on a stale digest, an epic with no
   tickets, a ticket with no epic or in two epics, acceptance criteria (done_when) outside 2 to 8,
   duplicate titles, a dependency pointing nowhere, or a dependency loop.
3. Duplicate search. Search the tracker for issues similar to each epic and ticket, by key phrases.
   Show the matches before anything is posted; the user decides through the host's choice prompt
   whether a ticket is new, a duplicate, or extends an existing issue (AC-9). Read only.
4. Judgment checks. Apply `references/review-checklist.md`: each ticket serves its epic's goal, a
   developer would know when it is done, nothing in "what exists today" contradicts the docs, the
   split is sensible, no similar issue exists, and each ticket is a real user story
   (`references/user-stories.md`).

## If the checks cannot run

Do the same checks by hand:

- Prose, by hand: read every title, goal, story line and acceptance criterion for em or en dashes,
  for code words (paths, function or class names, camelCase or snake_case, backtick code, web
  request verbs, database terms, library names), and for any deny-list jargon in `plain-language.md`.
  Ignore quoted text, code blocks and URLs; a confirmed permission key in inline code is allowed.
  Propose a fix for each and re-read until clean.
- Structure, by hand: every epic has at least one ticket; every ticket has exactly one epic; every
  ticket has 2 to 8 Given/When/Then acceptance criteria; no two titles match; every dependency points
  to a ticket in the set or a real issue; no dependency loop.
- Duplicate search, by hand: search the tracker for similar issues by key phrases and show the
  matches before posting.
- Judgment, by hand: work through `references/review-checklist.md`, including the story shape
  (As a, I want, So that) from `references/user-stories.md`.

## Output

The readiness block of the discovery record: status (passed or open), checks run, reviewer, and
notes including the duplicate matches shown. post-tickets proceeds only once readiness is passed.
