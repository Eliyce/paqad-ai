# Read back what was written: API

This feature has no network or HTTP API. Its programmatic surface is one command-line script,
run by the host inside the skill (or by hand for debugging). It reads JSON and prints JSON; it
writes nothing to any tracker.

## check_readback.py

```
check_readback.py --approved <approved.json> --created <live-issues.json>
```

| Argument | Meaning |
|---|---|
| `--approved` | The approved work: a post-tickets ticket set (has `epics`) or a refine change set (has `changes`, no `epics`). |
| `--created` | The live issues read back from the tracker, as a list of issue objects. |

### Input: approved

A ticket set is the canonical `ticket-set.json` (epics with tickets). A change set is what
`diff_ticket.py` emits: `{ ticket_key, changes: [{field, before, after, op}], new_children, digest }`.

### Input: created (live issues)

A list of objects. For a ticket set each object is
`{ ref, title, type, parent, labels, links: [{target}], sources_ref, body }`. For a change set the
list is read leniently, so the refine snapshot shape works too: `ref` or `key`; `summary` or
`title`; `description` or `body`; `labels`; `parent`; `links` as plain refs or `{target}`; and an
optional `comments` list.

### Output (stdout)

```json
{ "ok": true, "status": "match", "differences": [] }
```

`status` is `match`, `partial` or `mismatch`. `differences` is a list of `{code, ref, message}`
rows, with codes `MISSING`, `DIFF` or (ticket-set path only) `EXTRA`. Exit 0 on a full match, 1
otherwise. On a load error it prints `{ "ok": false, "error": ... }` to stderr and exits 1.

The change-set path checks only the changed fields of the edited ticket plus any new children,
honouring replace versus append ops, and never flags `EXTRA` (EDT-10). The ticket-set path is
unchanged (PUB-6).
