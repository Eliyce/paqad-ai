---
name: check-tickets
description: "Chat and Claude Code: Step 5 checking of the discover idea journey. Runs the prose check and the structure check over the drafted ticket set, searches the tracker for duplicate or similar issues and shows the matches before anything is posted, and applies the judgment checks for whether each ticket serves its epic and is testable. Produces the readiness block of the discovery record. Runs when the discover journey directs it; not started directly."
compatibility: "claude.ai chat, Cowork or Claude Code; reads project docs and code through a connector, uploaded files or the open folder"
---

# check-tickets

How to talk: before replying, follow `references/voice.md`. Short by default, lead with the
answer, plain business words, no narration, one short sources line at the end. Those rules win
over everything else here.

## When this runs

Runs when the discover journey directs it; not started directly. It is the checking half
of step 5, and runs after write-tickets has drafted `ticket-set.json`. Say the one-line status
when you enter it, for example "Step 5 of 6: checking the tickets."

## What it does

Check the drafted set three ways, then report readiness.

1. Prose check. If you have a tool that runs scripts, run `scripts/check_prose.py --ticket-set
   <ticket-set.json>`. It flags em and en dashes (TKT-1), code words in the title, goal, the story
   lines (As a, I want, So that) and the acceptance criteria (TKT-2; a confirmed permission key in
   inline code is allowed), and jargon from the shared `plain-language.md` deny-list
   (TKT-3), each with a line and a suggested fix. It skips quotes, code blocks and URLs, so quoted
   evidence is never rewritten. Fix the findings and run it again until it is clean.
2. Structure check. Run `scripts/check_ticket_set.py --ticket-set <ticket-set.json>`. It validates
   the set against the schema, recomputes the digest, and fails on a stale digest, an epic with no
   tickets, a ticket with no epic or in two epics, acceptance criteria (done_when) outside 2 to 8,
   duplicate titles,
   a dependency pointing nowhere, or a dependency loop.
3. Duplicate search. Search the tracker for issues similar to each epic and ticket, by key phrases.
   Show the matches to the user before anything is posted, and let the user decide through the
   host's choice prompt whether a ticket is new, a duplicate, or should extend an existing issue
   (AC-9). This search only reads.
4. Judgment checks. Apply `references/review-checklist.md`: does each ticket serve its epic's goal,
   would a developer know when it is done, is anything in "what exists today" contradicted by the
   docs, is the split sensible, are there similar issues already in the tracker, and is each ticket
   a real user story by the rules in `references/user-stories.md`.

## If the checks cannot run

When no tool can run the scripts, do the same checks by hand:

- Prose, by hand: read every title, goal, story line and acceptance criterion for em or en dashes,
  for code words (paths, function or class names, camelCase or snake_case, backtick code, web
  request verbs, database terms, library names), and for any deny-list jargon in `plain-language.md`.
  Ignore quoted text, code blocks and URLs; a confirmed permission key in inline code is allowed.
  Propose a fix for each and re-read until clean.
- Structure, by hand: every epic has at least one ticket; every ticket has exactly one epic; every
  ticket has 2 to 8 Given/When/Then acceptance criteria; no two titles match; every dependency points to a ticket in
  the set or a real issue; and there is no dependency loop.
- Duplicate search, by hand: search the tracker for similar issues by key phrases and show the
  matches before posting.
- Judgment, by hand: work through `references/review-checklist.md`, including the story shape
  (As a, I want, So that) from `references/user-stories.md`.

Reaching the same findings by hand gives the same readiness result as the scripts.

## Output

Fills the readiness block of the discovery record: the status (passed or open), the checks run,
the reviewer, and any notes, including the duplicate matches shown to the user. post-tickets only
proceeds once readiness is passed.
