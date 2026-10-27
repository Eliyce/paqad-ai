# Read back what was written: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `shared/scripts/check_readback.py` | `norm_text`, `norm_title`, `norm_ref`, `expected_items`, `created_record`, `compare`, `main` |

Reading issues from the tracker is done by the host connector in the calling skill; this script only compares two JSON files.

## Data Contracts

`--approved`: a canonical ticket set (`skills/write-tickets/assets/ticket-set.schema.json`). Flattened per ref:

| Field | Epic | Ticket |
|---|---|---|
| `title` | `norm_title(title)` | `norm_title(title)` |
| `type` | `tracker.epic_type` | `tracker.story_type` |
| `parent` | empty | epic `ref` |
| `labels` | epic `labels` (set) | empty set (tickets carry no labels in the schema) |
| `links` | empty set | `depends_on` refs |
| `sources_ref` | `"<run_id> / <ref>"` | `"<run_id> / <ref>"` |
| `body` | `norm_text(body_markdown)` | `norm_text(body_markdown)` |

`--created`: a JSON list of objects:

```json
[{"ref": "E1-T1", "title": "...", "type": "Story", "parent": "E1", "labels": ["dr-20261005-7k2q"],
  "links": [{"target": "E1-T2"}], "sources_ref": "DR-20261005-7K2Q / E1-T1", "body": "..."}]
```

Normalisation: `norm_text` strips leading list markers (`-`, `*`, `+`, `1.`, `1)`), backslash escapes, collapses whitespace and case-folds; `norm_title` collapses whitespace and case-folds; `norm_ref` removes all whitespace and case-folds.

Output (stdout, indented JSON):

```json
{"ok": false, "status": "partial", "differences": [{"code": "MISSING", "path": "E2-T2", "message": "Approved item was not created."}]}
```

## Script Interfaces

`check_readback.py --approved <ticket-set.json> --created <created-issues.json>`

| Exit | When |
|---|---|
| 0 | `status` is `match` |
| 1 | `partial` or `mismatch` |
| 1 | `ValueError`, `OSError`, `KeyError` or `TypeError` when run as a script: `{"ok": false, "error": "<message>"}` on stderr |

Importable API used elsewhere: `compare(approved, created) -> (status, differences)`; `norm_ref` is imported by `skills/plan-sprint/scripts/fit_sprint.py`.

## State Management

None: stateless.

## Error Codes

| Code | Meaning |
|---|---|
| `MISSING` | An approved ref has no created issue |
| `DIFF` | A created issue differs; message lists the fields (`title`, `type`, `parent`, `sources_ref`, `body`, `labels`, `links`) |
| `EXTRA` | A created issue's ref is not in the approved set |

Status: `match` (no differences), `partial` (differences and at least one match), `mismatch` (no matches).

## Dependencies

| Kind | Detail |
|---|---|
| Shared imports | `canonical.py` (`load`, `issue`), from discovery-record |
| Declared by skills (`build/skills.yml`) | `post-tickets`, `refine-ticket`, `plan-sprint` import `scripts/check_readback.py` and `scripts/canonical.py` |
| Shape limit | `compare` only understands the ticket-set shape (`epics[]`). `refine-ticket` names it with `--approved <change-set.json>`, and the change set from `diff_ticket.py` has no `epics`, so that call yields no expected items; `plan-sprint` uses only `norm_ref` |
| Host capability | A connector "read issue" action to produce the created-issues file; a tool that runs scripts, otherwise the checklist fallback |

## Configuration

None.

## Testing Entry Points

| File | Tests |
|---|---|
| `tests/scripts/test_posting.py` | `ReadbackTest.test_match`, `test_partial_when_one_issue_missing`, `test_partial_when_body_differs`, `test_mismatch_when_nothing_created`, `test_whitespace_and_list_markers_normalised` (AC-13, PUB-6) |
| `tests/scripts/test_sprint.py` | `ApplyTest.test_apply_sets_only_chosen_with_readback` (exercises `norm_ref` through `fit_sprint.py`) |

No unit test covers the refine-ticket read-back path.
