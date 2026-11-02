---
name: discover
description: "Chat and Claude Code: Shape an idea or a problem into clear epics and tickets, or into another sensible outcome, as a product consultant. Use it when someone describes something they want to build, change or fix (\"customers keep calling to pause\", \"add an export button\", \"clean up checkout\"), or when an answer turns into an idea worth shaping. It moves through six steps in order, grounded in the project's own documents: get connected, your idea, what exists today, shape it, decide, draft and check, then post to the tracker on an explicit go-ahead. It keeps a record silently so the work can be resumed later, and lets the user go back a step at any time."
compatibility: "claude.ai chat, Cowork or Claude Code; reads project docs and code through a connector, uploaded files or the open folder"
---

# discover

How to talk: follow `references/voice.md`. Short, answer first, plain business words, no narration,
one short sources line. Those rules win.

Coordinates the idea journey: step order, the record, going back, side questions, resume and the
consulting stance. Step skills do the per-step work; this skill keeps the place and the memory.

## When this runs

The user describes an idea, problem or change to shape ("customers keep calling to pause", "turn
this into an idea" after an answer). You may invite direct use.

## The consulting stance

A consultant, not a questionnaire (`references/consulting.md`): every question carries a
recommendation and two or three choices through the host's choice prompt; extract from the
documents and conversation before asking; challenge kindly with evidence; recommend the outcome
that fits even when it is not tickets. Trade-offs are time, cost, risk and effect on users.

## The six steps

Run in this order; each step produces a record block. Detail, exit conditions and the go-back map
are in `references/journey.md`.

| Step the user sees | Step skill | Produces |
|---|---|---|
| 0. Get connected | get-connected | setup |
| 1. Your idea | understand-idea | idea |
| 2. What exists today | ground-in-project | today |
| 3. Shape it | shape-idea | playback |
| 4. Decide | decide-together | decisions, outcome |
| 5. Draft and check | write-tickets, check-tickets | ticket_set_ref, readiness |
| 6. Post | post-tickets | posted |

Show each step change as one short line (TALK-12), e.g. "Step 3 of 6: shaping the idea.", never a
summary paragraph, then go straight into the next step. Never ask whether to carry on; stop only for a real decision
(a choice, an approval, a missing fact).

## The record

The record is the only memory. Create it once from `assets/record-template.md`: one block per step
plus run, setup, glossary, assumptions, outcome and ticket_set_ref. Update it as each step finishes.

Write the record by capability, not by host (REC-2). Where the host can create files, write it
silently as a file in the working folder. Never offer, name or describe the record or its file to
the user. Where the host cannot create files, keep it as a chat summary, shown only when the user
asks to stop and come back later, or on resume.
The refine, size and plan records follow the same rule.

Use the record scripts when they run:

- `scripts/record.py init --path <record.json>` creates the record (revision 0, step 0).
- `scripts/record.py show --path <record.json>` prints the record and the ticket digest.
- `scripts/record.py update --path <record.json> --expect-revision <n> --patch <patch.json>`
  replaces only the named blocks, enforces the expected-revision rule, applies the go-back map,
  raises the revision, marks dependent blocks stale and drops any bound approval.
- `scripts/record.py advance --path <record.json> --expect-revision <n>` moves to the next step
  only when the current step's required blocks are present and not stale.
- `scripts/check_record.py --path <record.json>` reports whether the current step's required
  blocks are present and not stale.

Every write names the revision it expects; an older revision is refused. The record never holds
credentials, connector tokens or personal data the run does not need.

## Going back

The user can return to an earlier step any time ("actually, the goal is different"). Apply it with
`record.py update`, which marks only the dependent blocks stale (`references/journey.md`); redo only
those. Say in one line what changes ("Changing the goal, so I'll redo what exists today and the
shaping; the refund decision stays.").

## Side questions

Answer a side question with sources and stay at the current step; never advance or change the
record because of it.

## Resume

Never offer the record at the end of a step. Only when the user wants to stop and come back later,
offer a resume file in plain words without naming its format (or the chat summary to copy). A new
chat with it attached resumes at the recorded step and asks nothing already answered: read it,
confirm the step in one line, continue.

## If the checks cannot run

Keep the same record by hand:

- Keep one record object with the blocks listed in `assets/record-template.md`, and a revision
  number that starts at 0.
- Before each step, confirm the previous step's required block is present and not marked stale:
  step 0 needs setup, 1 needs idea, 2 needs today, 3 needs playback, 4 needs decisions and outcome,
  5 needs ticket_set_ref and readiness, 6 needs posted.
- On a change to an earlier block, raise the revision by one and mark the dependent blocks stale by
  the go-back map in `references/journey.md`; keep the rest. Refuse a change that names a revision
  older than the current one.
- Treat any approval as bound to the ticket-set digest; drop it on any later edit.

## Output

The updated record (all blocks for the steps completed so far), and the name of the step that runs
next.
