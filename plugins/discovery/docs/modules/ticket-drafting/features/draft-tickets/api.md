# Draft the ticket set: API

This feature has no network or HTTP API and no script. It is the `write-tickets` step skill, run
at step 5 only when the `product-discovery` journey directs it. It reads the record blocks
`idea`, `today`, `playback`, `decisions` and `assumptions`, and the references `user-stories.md`,
`writing-rules.md` and `plain-language.md`.

## Output

`ticket-set.json` in the shape fixed by `skills/write-tickets/assets/ticket-set.schema.json`:

| Field | Content |
|---|---|
| `run_id`, `revision`, `digest`, `tracker` | Run label, record revision, canonical sha256 of the set without `digest`, tracker profile |
| `epics[]` | `ref` (E1), `title`, `body_markdown`, `labels`, `tickets` |
| `epics[].tickets[]` | `ref` (E1-T1), `title` (at most 80 characters), `body_markdown` (the user-story layout), `done_when` (2 to 8 Given/When/Then acceptance criteria, one per item), `depends_on` (refs or tracker keys), `assignee_hint` |

The record block `ticket_set_ref` `{path, digest, revision}` points to the file; the coordinator
writes it with `record.py update`. A compact preview goes in chat and the full text in a
downloadable preview file where the host can create files.

## Questions before drafting

Implementation Target, Module Name and any permission key are settled through the host's choice
prompt before any ticket is written (TKT-6); a confirmed key is recorded as a decision.
