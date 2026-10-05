# Rich content (EDT-7)

A ticket description in the tracker can hold content that plain text cannot carry. Replacing such a
description with plain text would drop that content silently. So when the current description is rich,
never replace it: append the improved text as a clearly marked new section or a comment instead, and
say which you did (EDT-7, U-16).

## How to tell a description holds rich content

Treat a description as rich when it contains any of:

- Images or inline attachments (a screenshot pasted into the body, an attached file shown inline).
- Panels, info or note boxes, expand or collapse blocks, status lozenges.
- Mentions of people or of other issues (an @name, a linked issue card).
- Tables with merged cells, or tables whose layout carries meaning.

Tracker document formats record these as structured nodes, not as plain text. A community report notes
that converting such a body to plain text can drop images and panels (U-16), so the safe rule is: if
in doubt, treat it as rich and append rather than replace.

## The rule

- Do NOT emit a plain-text `replace` of a rich description. `scripts/diff_ticket.py` applies this
  guard for you: when the current description is rich, it returns the description change with an `op`
  of `append_section` or `append_comment` rather than `replace`, and records which it used.
- `append_section` adds the improved text as a new, clearly marked section at the end of the existing
  description, leaving the original content intact.
- `append_comment` adds the improved text as a comment on the ticket, leaving the description
  untouched. Use this when even appending to the description would disturb its layout.
- Always say which one you used when you report the change, so the user knows where the improved text
  landed and that nothing was overwritten.

## A plain description

When the description is plain text with no rich content, a normal `replace` is fine, subject to the
usual approval (EDT-5) and conflict check (EDT-6). The guard only changes behaviour for rich
descriptions.
