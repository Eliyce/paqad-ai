---
name: post-tickets
description: Step 6 hand off of the product-discovery idea journey. Recommends the outcome, and for a build it shows a compact preview plus a full preview file, takes an explicit "post it" bound to the ticket-set digest, creates epics then tickets then links in order with parents, records a receipt for each write, reconciles a lost reply without creating duplicates, reads back what was created and reports partial results honestly, and offers a CSV or Markdown export as a fallback. Produces the posted block of the discovery record. Runs when the product-discovery journey directs it; not started directly.
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
the full ordered procedure and `references/tracker-profiles/jira.md` for the Jira actions and the
known tool-name variants.

1. Recommend the outcome that fits: build, experiment, already exists, process change, defer or
   stop. For anything other than build, give a short written summary of the decision and the next
   action, and offer to post it as a single tracker item if the user wants one.
2. For a build, show the final set as a compact table in chat (one row per epic and ticket) plus a
   full preview file. Put the full text in chat only if the user asks or no file can be made.
3. Take the approval. Post only after an explicit "post it", bound to the ticket-set digest.
   "Looks good" is not approval. Any later edit to the set voids the approval and needs a new one.
4. Build the ordered plan and post it. If you can run scripts, use `scripts/plan_posting.py plan
   --state <state.json>`, then `next`, `claim`, `record` and `reconcile` to drive the run. The
   order is epics first, then each epic's tickets with the created epic as parent, then the
   dependency links, then read-back. If the connector refuses the parent parameter for an epic
   child, set the parent through its additional fields. When the connector exposes a link action,
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
   tracker importer, using `scripts/export_csv.py --ticket-set <ticket-set.json>`. Offer this when
   the connector cannot create issues.

## If the checks cannot run

When no tool can run the scripts, post by hand with this checklist:

- Recommend the outcome; for a build, show the compact preview plus the full preview file.
- Take an explicit "post it" bound to the digest; a later edit voids it.
- Create in order: epics first, then tickets with the created epic as parent, then links with the
  link action, then read-back. Use the additional-fields route if the parent parameter is refused.
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
and its status (created, uncertain, or not applied), plus the read-back result. The links and any
difference are reported to the user in plain words.
