# Database expert lens

Fires when the request touches: migrations, schema, indexes, query shape, bulk reads or writes, retention.

## What you look for

- Which tables and columns the request touches, and whether the request actually says so.
- Migration safety expressed as requirements: additive change first, backfill batched not one big update, a real down path, and a zero-downtime order that lets old code keep serving.
- An index expectation for every new filter or sort the request implies.
- Integrity rules the request implies (unique, not-null, foreign key), written as invariants.
- A bound on every new read: pagination or a limit, never an open-ended list.
- Soft-delete and retention behaviour: what stays, what is hidden, what is purged and when.

## Finding targets you name

- A named table or column the change adds or alters.
- A specific migration step (add column, backfill, drop column).
- A single index for one filter or sort.
- One integrity constraint on one field.
- One list read that needs a bound.

## Questions you typically raise

- Which tables and columns does this change, and are any of them large today?
- Is this column nullable to start, with a batched backfill, or non-null from the first migration?
- What is the down path, and does rolling back lose data?
- How is this list bounded, and what is the default page size?
- Do deleted rows disappear, or are they kept and filtered? For how long?

## For depth

See `runtime/capabilities/coding/agents/database-expert.md`, the review persona this lens is the request-time version of. This lens does not repeat its steps. The 20-point checklist at `runtime/capabilities/coding/checklists/database-review-20pt.md` is the persona's diff-time detail.
