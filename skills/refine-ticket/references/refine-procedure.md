# Refine procedure

The ordered procedure for refining an existing ticket, with the EDT rules it enforces. Follow it top
to bottom for each ticket. Rich-content handling has its own page: `rich-content.md`.

## 1. Read and snapshot (EDT-1)

Read the ticket in full before changing anything: summary, description, type, parent, labels, links,
status, assignee, sprint and the size field. Keep a snapshot of that state, including its
last-updated time, in the `existing` block of the record. The snapshot is the baseline the conflict
check (step 6) compares against, so take it before any edit and do not re-take it unless you mean to
re-baseline.

## 2. Diagnose before changing (EDT-2)

Say what is wrong in plain business words, and give evidence for each finding. Common findings:

- No acceptance criteria (done when), or outcomes that cannot be tested.
- Jargon or code words where business words belong (use `plain-language.md`).
- No "not included", so the edges are unclear.
- A contradiction with the project's documents.
- Too big for one ticket (a split candidate, step 4).
- A missing parent or a missing dependency.

Run `scripts/check_prose.py --ticket-set <draft.json>` to flag em and en dashes, code words and
deny-list jargon with a line and a suggested fix. It skips quotes, code blocks and URLs, so quoted
evidence is never rewritten. Each finding names its evidence; diagnosis comes before any proposal.

## 3. Preserve the author's intent (EDT-3)

Keep the original meaning and the author's wording where it is already clear. Improve the ticket;
never rewrite it into a different thing. If the ticket really describes a different or larger piece
of work, stop and recommend shaping it through `product-discovery` instead of forcing it here. Follow
`writing-rules.md` when you do reword a field.

## 4. Propose a field-by-field change set (EDT-4, EDT-8)

Show every changed field as before and after. The change set is limited to summary, description,
labels, parent, links, and new child tickets on a split. Status, assignee, priority, sprint and the
size field change only when the user explicitly asks for that exact change.

Build the set with `scripts/diff_ticket.py --snapshot <snapshot.json> --proposed <proposed.json>`. It
returns a `change_set` with one entry per field (`before`, `after`, `op`) plus `new_children`, and a
`digest` over the set. A proposed change to a field outside the allowed list is reported as an issue,
not applied.

Splitting (EDT-8): when a ticket is too big, propose the split as new tickets under the same epic,
with the original kept and linked, never deleted. New tickets follow the posting rules in section 9
of REQUIREMENTS.md and the user story rules that write-tickets uses: a specific role, a capability
in plain words, a real outcome and Given/When/Then acceptance criteria.

## 5. Guard rich content (EDT-7)

If the current description holds content that plain text cannot carry (images, panels, mentions,
merged-cell tables), do not replace the description. `diff_ticket.py` emits an `append_section` or
`append_comment` op instead of a `replace`, and flags which it used. Full guidance is in
`rich-content.md`.

## 6. Approval bound to the change (EDT-5)

Apply only after an explicit "apply it" for that exact change set, bound to its digest. "Looks good"
is not approval. Any edit to the proposal after approval voids the approval: a fresh preview and a
fresh "apply it" are required before any write. The record drops a bound approval on any later edit,
so an edited change set is never written under a stale approval.

## 7. Conflict check just before writing (EDT-6)

Just before writing, read the live ticket again and run `diff_ticket.py` with `--live <live.json>`.
When the live `last_updated` is newer than the snapshot `last_updated`, the script sets `conflict`
true and withholds the change set. Stop, show what changed in the tracker since the snapshot, and ask
the user before going on. Do not write over an edit you have not shown.

## 8. Apply (EDT-9)

Write the approved change through the tracker. Never delete a ticket and never move it through
workflow states (no close, no status change) as part of a refine. A split creates new linked tickets;
it never removes the original.

## 9. Read back and report (EDT-10)

After applying, read each ticket back and compare with the approved change, normalised, using
`scripts/check_readback.py --approved <change-set.json> --created <live-after.json>`. Report the links
and any difference. A partial result is reported as partial, never as done.
