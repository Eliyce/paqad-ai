---
name: post-tickets
description: "Chat and Claude Code: Step 6 of the product-discovery journey: posts the approved tickets to the tracker or exports a CSV, links them and reads them back to confirm. At hand-off it also writes the short summary of the decision and the next action when the outcome is not a build (experiment, already exists, process change, defer or stop). Use when the journey directs it to step 6 or to the hand-off, not directly."
compatibility: "claude.ai chat, Cowork or Claude Code; reads project docs and code through a connector, uploaded files or the open folder"
---

# post-tickets

How to talk: before replying, follow `references/voice.md`. Short by default, lead with the
answer, plain business words, no narration, one short sources line at the end. Those rules win
over everything else here.

## When this runs

Runs when the product-discovery journey directs it; not started directly. It is step 6, Hand off,
and runs after check-tickets reports readiness passed. Say the one-line status when you enter it,
for example "Step 6 of 6: handing off."

## What it does

Recommend the outcome, and for a build, post it safely. Follow `references/post-procedure.md` for
the full ordered procedure and `references/tracker-profiles-jira.md` for the Jira actions and the
known tool-name variants.

1. Recommend the outcome that fits: build, experiment, already exists, process change, defer or
   stop. For anything other than build, give a short written summary of the decision and the next
   action, and offer to post it as a single tracker item if the user wants one.
2. For a build, show the final set as a compact table in chat (one row per epic and ticket) plus a
   full preview file. Put the full text in chat only if the user asks or no file can be made. An
   existing epic sits on its own row marked "not changed". Read it first (step 4, the verify
   operation): show its live title, and when that differs from the title read earlier, say so in
   one line and use the live title on each ticket's Epic line before the approval.
3. Take the approval. Post only after an explicit "post it", bound to the ticket-set digest.
   "Looks good" is not approval. Any later edit to the set voids the approval and needs a new one.
4. Build the ordered plan and post it. Where scripts can run, drive the run with these commands:

   - `scripts/plan_posting.py plan --state <state.json>` builds the ordered plan.
   - `scripts/plan_posting.py next --state <state.json>` shows the next write.
   - `scripts/plan_posting.py claim --state <state.json>` marks it in flight.
   - `scripts/plan_posting.py record --state <state.json> --operation <id> --receipt <receipt.json>`
     records the reply.
   - `scripts/plan_posting.py reconcile --state <state.json> --operation <id> [--tracker-issues
     <found.json>]` settles an uncertain write.
   - `scripts/plan_posting.py resume --state <state.json>` starts a resumed run: every epic check
     is due again before any create.

   The order is the read-only check of every existing epic first (`verify-E<n>`), then new epics,
   then each epic's tickets with their epic as parent (the created epic, or the literal key of an
   existing one), then the dependency links, then read-back. If the connector refuses the parent
   parameter for an epic child, set the parent through its additional fields.

   An existing epic is never created, edited, labelled, commented on, linked or moved: the only
   operation on its key is the read. Do the read, then record what came back as the receipt of its
   verify operation: `{"status": "read", "result": {"key", "issuetype", "project", "summary",
   "status", "done"}}`, `{"status": "not_found"}`, or `{"status": "read_failed", "reason"}` when
   the read timed out, was refused or the connector failed. Set `done` from the status the issue
   reports as finished, not from a status name. The read needs no approval; repeat it on every
   resume and retry, and when its reply was lost, read again. Nothing is created until every check
   passes. When one fails, stop, say which check failed (or that the epic could not be checked),
   and offer the two ways on: pick another epic or a new epic, back at the step 4 question, or
   leave by export. A failed read is "could not check the epic", never "the epic does not exist".
   When the epic is done or closed and that was not confirmed at step 4, ask before the first
   create; record the answer with `"done_confirmed": true` or `false`. A no creates nothing and goes back to the step 4 question.

   If the first ticket under an existing epic is refused with that parent, stop there: create no
   ticket without its parent, never edit the epic to attach tickets, and offer the export. If
   neither the parent on create nor the import puts the tickets under the epic, say plainly that
   they are not under the epic yet and how to move them; never report a clean success. When the connector exposes a link action,
   create links only with it. When it exposes no link action, do not drop the dependencies: write
   each one as a "Depends on" text line in the ticket body or a comment, and ask the user to add
   the links by hand in the tracker (U-3). The plan marks this case with `links_by_hand` so the
   fallback is explicit and the dependencies are never lost.
5. Record a receipt for each write: created, uncertain, or not applied. Mark the item in flight
   before the write. On a lost or timed-out reply, mark it uncertain, stop dependent writes, wait,
   then search by the run label and the item reference. If found, record it as created. If not
   found, ask the user before any retry and say that the tracker search can lag. Never retry an
   uncertain create without the user's answer, and never delete a created issue as a rollback.
6. Read back. Use `scripts/check_readback.py --approved <ticket-set.json> --created
   <created-issues.json>` to compare what was created against the approved set after normalising
   title, type, parent, labels, links, the Sources item reference and the body text. Report a
   partial result as partial, never as done, and give the links. When the links were added by hand
   because the connector had no link action, report on read-back that the links may be absent rather
   than report it as a failure.
7. Export fallback. At any point the approved set can be downloaded as Markdown and as CSV for the
   tracker importer, using `scripts/export_csv.py --ticket-set <ticket-set.json> [--format csv|markdown]`.
   The format defaults to `csv`; add `--format markdown` for the Markdown export. Offer this when
   the connector cannot create issues. An existing epic gets no row and `Parent` holds its key.
   Give the note from `scripts/export_csv.py --ticket-set <ticket-set.json> --note` with the file:
   "Parent holds the existing epic key ABC-7. If your importer does not accept it, set the parent with a bulk edit after the import."
   It also names the rows that hold the real key. On resume with an unreadable tracker, export
   with the key and say the epic was last checked in the earlier session and is not confirmed now.
8. When the tracker is GitHub, follow `references/tracker-profiles-github.md`: GitHub Issues is export
   only, so there is no posting step. Produce the Markdown export as the primary form, since GitHub has
   no native bulk CSV import, and map each epic to a tracking issue or a milestone and each dependency
   to a task-list reference in the body. The user creates the issues in GitHub themselves.

## If the checks cannot run

When no tool can run the scripts, post by hand with this checklist:

- Recommend the outcome; for a build, show the compact preview plus the full preview file.
- Take an explicit "post it" bound to the digest; a later edit voids it.
- Create in order: read every existing epic first, then new epics, then tickets with their epic as
  parent, then links with the link action, then read-back. Use the additional-fields route if the
  parent parameter is refused.
- An existing epic: confirm it exists, is of the epic type and sits in the project before any
  create; stop and name the failed check otherwise. Ask first when it is done or closed. Never
  create, edit, label, comment on or link it. Show it as "not changed" in the preview and the
  posted block.
- When no link action is available, write each dependency as a "Depends on" text line in the ticket
  body or a comment and ask the user to add the links by hand; on read-back report that links may be
  absent, not as a failure.
- For each write: mark it in flight, then record created, uncertain, or not applied. On a lost
  reply, stop dependent writes, wait, search by run label and item reference, and ask before any
  retry. Never retry an uncertain create unasked and never delete a created issue to roll back.
- Read each created issue back against the approved set and report partial honestly.
- Offer the CSV and Markdown export when the tracker cannot be written to.

## Output

Fills the posted block of the discovery record: each issue with its item reference, its issue key,
and its status (created, uncertain, or not applied; an existing epic is "not changed" and is never
counted as created), plus the read-back result. The links and any
difference are reported to the user in plain words.
