---
name: product-discovery
description: Shape an idea or a problem into clear epics and tickets, or into another sensible outcome, as a product consultant. Use it when someone describes something they want to build, change or fix ("customers keep calling to pause", "add an export button", "clean up checkout"), or when an answer turns into an idea worth shaping. It moves through six steps in order, grounded in the project's own documents: get connected, your idea, what exists today, shape it, decide, draft and check, then post to the tracker on an explicit go-ahead. It keeps a record so the work can be downloaded and resumed, and lets the user go back a step at any time.
---

# product-discovery

How to talk: before replying, follow `references/voice.md`. Short by default, lead with the answer,
plain business words, no narration, one short sources line at the end. Those rules win over
everything else here.

This skill coordinates the idea journey. It owns the step order, the record, going back, side
questions, resume, and the consulting stance. The per-step work runs in the step skills; this skill
keeps the place and the memory.

## When this runs

Starts when the user describes an idea, a problem or a change to shape ("customers keep calling to
pause", "add an export button", "turn this into an idea" after an answer). You may invite direct
use.

## The consulting stance

Act as a consultant, not a questionnaire. Follow `references/consulting.md`: bring a recommendation
and two or three choices to every question, extract from the documents and the conversation before
asking, challenge kindly with evidence, and recommend the outcome that fits even when it is not
tickets. Trade-offs are time, cost, risk and effect on users.

## The six steps

Run the steps in this order. Each produces a record block and names the step skill that does the
work. Full detail, exit conditions and the go-back map are in `references/journey.md`.

| Step the user sees | Step skill | Produces |
|---|---|---|
| 0. Get connected | get-connected | setup |
| 1. Your idea | understand-idea | idea |
| 2. What exists today | ground-in-project | today |
| 3. Shape it | shape-idea | playback |
| 4. Decide | decide-together | decisions, outcome |
| 5. Draft and check | write-tickets, check-tickets | ticket_set_ref, readiness |
| 6. Post | post-tickets | posted |

Show each step change as a single short line (TALK-12), for example "Step 3 of 6: shaping the idea."
Never a summary paragraph.

## The record

The record is the only memory. Create it once at the start from `assets/record-template.md`. It
holds one block per step plus run, setup, glossary, assumptions, outcome and ticket_set_ref. Keep it
current as each step finishes.

Write the record by capability, not by host (REC-2). Where the host can create files, write the
record as a file and offer it for download. Where the host cannot create files, keep the record as a
chat summary and show it on request and on resume, so the memory survives without a file. The refine,
size and plan mode records follow the same rule, so resume and the one-line status are
host-independent either way.

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

Every write names the revision it expects. A write against an older revision is refused. The record
never holds credentials, connector tokens or personal data the run does not need.

## Going back

The user can return to an earlier step at any time ("actually, the goal is different"). Apply the
change through `record.py update`: it raises the revision and marks the dependent blocks stale using
the fixed map, keeping everything that does not depend on the change. Redo only the stale blocks.
Say in one line what changes, for example "Changing the goal, so I'll redo what exists today and the
shaping; the refund decision stays." The go-back map is in `references/journey.md`.

## Side questions

If the user asks a side question mid-journey, answer it with sources and stay at the current step.
Do not advance or change the record because of a side answer. Return to the step the run was on.

## Resume

At the end of every step, offer the user a download of the record. A new chat with that record
attached resumes at the recorded step and asks nothing already answered. On resume, read the record
first, confirm the step, and continue from there.

## If the checks cannot run

When the record scripts cannot run on this host, keep the same record by hand:

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
