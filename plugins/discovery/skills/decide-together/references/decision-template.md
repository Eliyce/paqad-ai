# Decision and assumption templates

verified: 2026-11-02

Step 4 records two kinds of thing: a decision the user made, and an assumption the user accepted
as a default when they did not know. They are kept apart on purpose, so a guess is never read
later as a settled call.

## A recorded decision

Each decision has these fields:

| Field | What it holds |
|---|---|
| id | A short stable id for the decision, for example `D1`. |
| question | The open choice in one plain line. |
| choice | What was decided, in the user's words where they are clear. |
| by | Who decided (usually the user; name them if they named someone). |
| why | One short clause of the reason. Leave it brief. |

A decision is recorded only after the user actually chooses. A recommendation you offered is not
a decision until they accept it.

## The epic choice

The answer to "Where should these tickets go?" is one more recorded decision, with one extra field,
`epic_choice`: a list with one choice per planned epic, in epic order.

| Choice | Shape |
|---|---|
| A new epic | `{ "mode": "new" }` |
| An existing epic | `{ "mode": "existing", "key": "ABC-7", "title": "<title as read>" }` |

It sits in the decisions block, inside the go-back chain: a redraft keeps it, and changing it marks
the ticket set, the readiness and the posting stale, so the preview and the approval come again.
One run may mix a new epic and an existing one. The existing epic is never created or changed.
After a repository is connected in the middle of a run, the question is asked again with the
earlier choice recommended. On resume with the tracker no longer readable, keep the choice; if the
user does not reconnect, the tickets leave by export with the epic key, and one line says the epic
was last checked in the earlier session and is not confirmed now.

## A recorded assumption

When the user says "I don't know", offer a sensible default, label it as an assumption, and record
it here instead of in the decisions block:

| Field | What it holds |
|---|---|
| id | A short stable id, for example `A1`. |
| question | The choice that was left open. |
| default | The default you applied, in plain words. |
| why | One short clause of why this is a reasonable default. |

Every assumption is shown to the user as an assumption, not a fact, and carries into the epic or
ticket as an open question or a stated assumption, never as an invented commitment (TKT-5).

## Example (structure only, not real content)

- Decision: id `D1`, question "which customers can do this first", choice "existing paying
  customers only", by the user, why "lowest support risk".
- Assumption: id `A1`, question "how long to keep the record", default "twelve months", why
  "matches the current retention for similar data; confirm with the data owner".
