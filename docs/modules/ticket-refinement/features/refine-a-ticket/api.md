# Refine an existing ticket: API

This feature has no network or HTTP API. All tracker reads and writes go through the host's own
connector. The feature's own programmatic surface is one command-line script that plans the
change; it writes nothing to any tracker.

## diff_ticket.py

```
diff_ticket.py --snapshot <snapshot.json> --proposed <proposed.json> [--live <live.json>]
```

| Argument | Meaning |
|---|---|
| `--snapshot` | The ticket state captured at the start of the refine, with `last_updated` (EDT-1). |
| `--proposed` | The proposed field changes and any new children. |
| `--live` | The live ticket read again just before writing, for the conflict check (EDT-6). |

### Inputs

- snapshot: `{ key, fields: {summary, description, labels, parent, links}, last_updated }`.
- proposed: `{ ticket_key, fields: {<subset of the five>}, new_children: [{title, parent_epic, link_to}], description_mode: "section"|"comment" }`.
- live: `{ last_updated, ... }`.

### Output (stdout)

```json
{ "ok": true, "conflict": false,
  "change_set": { "ticket_key", "changes": [{"field","before","after","op"}], "new_children", "digest" },
  "issues": [] }
```

A proposed change to a field outside summary, description, labels, parent, links is refused
(`FIELD_NOT_ALLOWED`). A newer live `last_updated` sets `conflict` true and withholds the change
set (`CONFLICT`). Rich current descriptions emit `append_section` or `append_comment` rather than a
`replace` (`RICH_CONTENT_GUARD`). Exit 0 on a clean, conflict-free change set, 1 on a conflict or
error.

## Other scripts this feature calls (owned elsewhere)

| Script | Role |
|---|---|
| `check_prose.py` (tracker-checks) | Lint the proposed prose. |
| `check_readback.py` (tracker-checks) | Read each ticket back after applying, against the approved change set (EDT-10). |
| `record.py`, `check_record.py` (discovery-record) | Hold the `existing` and `changes` blocks and the digest-bound approval. |
