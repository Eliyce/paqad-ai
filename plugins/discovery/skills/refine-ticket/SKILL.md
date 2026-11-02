---
name: refine-ticket
description: "Chat and Claude Code: Improve one or more existing tracker tickets without losing the author's intent. Use it when someone wants a ticket read, diagnosed and tidied up (\"this ticket is vague\", \"fix up ABC-12\", \"split this, it's too big\"). It reads each ticket in full and snapshots it with its last-updated time, says what is wrong with evidence, and proposes a field-by-field before and after change set limited to summary, description, labels, parent, links and new child tickets on a split. It writes nothing until an explicit \"apply it\" bound to that exact change set, re-checks the ticket for conflicting edits just before writing, never replaces rich descriptions with plain text, never deletes or closes a ticket, and reads each ticket back after applying. Produces the existing and changes blocks of the record."
compatibility: "claude.ai chat, Cowork or Claude Code; reads project docs and code through a connector, uploaded files or the open folder"
---

# refine-ticket

How to talk: follow `references/voice.md`. Short, answer first, plain business words, no narration,
one short sources line. Those rules win.

## When this runs

Starts when the user points at one or more existing tickets to improve ("this ticket is vague",
"this is really three tickets"). You may invite direct use. If it really describes a different or
larger piece of work, recommend shaping it through `product-discovery` instead (EDT-3).

## What it does

Refine each ticket in order. Full procedure: `references/refine-procedure.md`; rich content:
`references/rich-content.md`; Jira actions: `references/tracker-profiles-jira.md`. Read project
documents as in `references/connect-repository.md` at the best evidence level available
(`references/evidence-levels.md`), and carry the level into each finding.

1. Read and snapshot (EDT-1). Read each ticket in full: summary, description, type, parent, labels,
   links, status, assignee, sprint and size field. Snapshot it with its last-updated time in the
   record as the conflict-check baseline.
2. Diagnose with evidence (EDT-2). Say what is wrong in plain words: missing acceptance criteria
   (done when), untestable outcomes, jargon, no "not included", a contradiction with the
   documents, too big for one ticket, a missing parent or dependency, each with its evidence. Check prose with
   `scripts/check_prose.py --ticket-set <draft.json>` and the deny-list in
   `references/plain-language.md`; follow `references/writing-rules.md` for the fixes. A
   contradiction that rests on a document's status line names it as what the docs say; a missing or
   template document is never a finding that the feature is missing; when whether the area exists
   matters to a finding and the code is reachable, check that area's code and label the finding
   "the code suggests"; all as in "What the documents prove" in `references/paqad-docs-map.md`. Each
   finding carries the evidence level it rests on; in code-only mode say the diagnosis is from code
   only and never claim a new area from missing documents.
3. Preserve intent (EDT-3): keep the meaning and the author's clear words; never turn a ticket into
   something else.
4. Propose a field-by-field change set (EDT-4, EDT-8). Show each changed field as before and after,
   limited to summary, description, labels, parent, links, and new child tickets on a split. Status,
   assignee, priority, sprint and size change only if the user asks for that exact change. Build the
   set with `scripts/diff_ticket.py --snapshot <snapshot.json> --proposed <proposed.json>`. On a
   split, new tickets sit under the same epic and the original is kept and linked, never deleted.
   New tickets follow write-tickets' user story rules: a specific role, a plain capability, a real
   outcome and Given/When/Then acceptance criteria.
5. Guard rich content (EDT-7). When the current description holds images, panels, mentions or
   merged-cell tables, never replace it with plain text; `diff_ticket.py` emits an `append_section`
   or `append_comment` op instead (`references/rich-content.md`).
6. Take approval bound to the change (EDT-5): an explicit "apply it" for that exact change set, bound
   to its digest. Any edit voids it and needs a fresh preview and approval.
7. Conflict check just before writing (EDT-6). Re-read the live ticket and run `diff_ticket.py` with
   `--live <live.json>`. If the live last-updated time is newer than the snapshot, stop, show what
   changed, and ask before going on.
8. Apply, then read back (EDT-9, EDT-10). Never delete a ticket and never move it through workflow
   states. After writing, read each ticket back and compare with the approved change using
   `scripts/check_readback.py --approved <change-set.json> --created <live-after.json>`. Report the
   links and any difference, and report a partial result as partial.

Record state is kept through `scripts/record.py` and checked with `scripts/check_record.py` (refine
mode); digests use `scripts/canonical.py`.

## If the checks cannot run

Refine by hand with this checklist:

- Read each ticket in full and write down a snapshot with its last-updated time.
- Diagnose in plain words with evidence for each finding; read the title, description and "done
  when" for em or en dashes, code words and `plain-language.md` jargon, ignoring quotes, code and
  URLs.
- Do "What the documents prove" in `references/paqad-docs-map.md` by hand: say an area the documents
  do not cover is not documented; never say or imply it is not built; report a document's status
  line as what the docs say, for the exact thing it names only; never use a requirements document as
  current behaviour; when the code is reachable, look at that area's names, open at most 5 files,
  and say at most one line per area, labelled "the code suggests".
- Write a field-by-field before and after, limited to summary, description, labels, parent, links
  and new child tickets on a split; keep the original on a split and link it under the same epic.
- If the description holds images, panels, mentions or merged-cell tables, append a marked section
  or a comment instead of replacing it, and say which you used.
- Take an explicit "apply it" for that exact change set; any edit voids it and needs a new approval.
- Just before writing, re-read the live ticket; if it changed since the snapshot, stop and ask.
- Never delete and never close a ticket. After writing, read each ticket back against the approved
  change and report the links and any difference honestly.

## Output

Two record blocks (refine mode): `existing`, the starting snapshots with last-updated times, and
`changes`, the approved field-by-field change set and new child tickets, bound to its digest. Links
and any read-back difference are reported in plain words.
