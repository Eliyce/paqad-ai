# Export tickets as CSV or Markdown: technical

## Module Boundaries

Owned path (module `ticket-posting`, feature `export-tickets`): `skills/post-tickets/scripts/export_csv.py`.

The instructions that offer the export live in `skills/post-tickets/SKILL.md` (step 7) and `skills/post-tickets/references/post-procedure.md` ("Export fallback (PUB-8)"), owned by feature `post-tickets`. The Markdown export has no script; it is instruction-only.

## Data Contracts

- Input: `ticket-set.json` (see `skills/write-tickets/assets/ticket-set.schema.json`).
- Output: CSV with header `Work type,Work item id,Summary,Description,Labels,Parent`, written by `csv.DictWriter`.

| Column | Epic row | Story row |
|---|---|---|
| Work type | `tracker.epic_type` (default `Epic`) | `tracker.story_type` (default `Story`) |
| Work item id | epic `ref` | ticket `ref` |
| Summary | epic `title` | ticket `title` |
| Description | epic `body_markdown` | ticket `body_markdown` |
| Labels | epic `labels` joined with spaces | empty |
| Parent | empty | parent epic `ref` |

Each epic row is immediately followed by its story rows. `depends_on` and `assignee_hint` are not exported.

## Script Interfaces

`export_csv.py --ticket-set <ticket-set.json> [--out <file.csv>]`

| Item | Value |
|---|---|
| Output | CSV to `--out` path, or to stdout when omitted |
| Exit | 0 on success; 1 on `ValueError`, `OSError`, `KeyError`, `TypeError` with `{"ok": false, "error": ...}` on stderr (error text is a Python `repr`, so not guaranteed strict JSON) |
| Side effects | Writes only the `--out` file; standard library only, no network |

## State Management

None. The script reads the ticket set and does not touch the record, receipts or digest. It does not check that the set is approved or that its digest is current; the instructions say to export "the approved set".

## Error Codes

None.

## Dependencies

| Kind | Dependency |
|---|---|
| Shared imports (`build/skills.yml`, skill `post-tickets`) | `scripts/canonical.py` (only `canonical.load` is used) |
| Other modules | `discovery-record` (canonical loader), `ticket-drafting` (input set) |
| Host capabilities | Running Python scripts; offering a file download |

## Configuration

`COLUMNS` constant in `export_csv.py` fixes the column order. No other configuration.

## Testing Entry Points

| Entry point | What it covers |
|---|---|
| `tests/scripts/test_posting.py` `ExportCsvTest`: `test_exact_columns`, `test_epics_before_their_stories`, `test_story_parent_is_epic_id` | PUB-8 columns and order |
| `tests/evals/scenarios/s1.yml` `ac-2` | Export offered when the tracker cannot create issues |
