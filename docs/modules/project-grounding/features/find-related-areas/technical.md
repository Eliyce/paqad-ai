# Find related areas: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `shared/scripts/find_related.py` | `tokens`, `parse_registry`, `term_matches`, `rank`, `plain_name_from`, `rows_from_modules_dir`, `load_rows`, `main` |
| `shared/references/paqad-docs-map.md` | GRD-2 reading order table (order 1 notes the partly ready map from folder names and summaries), its restatement of the three-state GRD-1 rule, GRD-5 sources rule |

Not owned here: the onboarded check and the area-summary reader (`shared/scripts/check_onboarded.py`, get-the-documents, which `find_related.py` imports), the repository rule (`shared/references/connect-repository.md`, get-the-documents) and the reading behaviour itself (the `ask-project` and `ground-in-project` skills).

## Data Contracts

Input registry: a Markdown file (target project's `docs/instructions/registries/modules.md`). Every line starting with `|` that splits into at least four cells is a row. Cells are read by position:

| Cell | Read as |
|---|---|
| 0 | `module` (rows where it is empty, equals `module` case-insensitively, or is only `-`, `:` and spaces are skipped) |
| 1 | `plain_name` |
| 2 | `layer` |
| 3 | `features` |

Terms: lowercase alphanumeric tokens of length 3 or more (`MIN_TERM = 3`) from all four cells.

Input modules folder (`--modules-dir`, used when the repository is partly ready): `rows_from_modules_dir` calls `check_onboarded.area_summaries` (it never reads the folders itself) and returns one row per area with a non-empty summary, in sorted area order, in the same row shape `parse_registry` returns:

| Field | Value |
|---|---|
| `module` | The area folder name |
| `plain_name` | The first summary line that starts with `# `, prefix removed and stripped; the folder name when there is none |
| `layer`, `features` | Empty strings |
| `terms` | Tokens of the folder name joined with tokens of the summary text |

Areas without a summary are skipped here; `check_onboarded.py` reports them as unknown.

Output (stdout), a JSON list in rank order:

```json
[{"module": "returns", "plain_name": "Returns and refunds", "score": 2, "matched_terms": ["refund", "return"]}]
```

`score` is the count of distinct query terms that match any module term, where a match is equality or a substring either way. Only rows with `score > 0` are returned. Sort is by descending score, ties by row order: registry order for `--registry`, sorted area order for `--modules-dir`. The same tree and query give byte-identical output, independent of filesystem listing order.

## Script Interfaces

`find_related.py (--registry <modules.md> | --modules-dir <docs/modules>) --query "<idea or question>"`

| Arg | Required | Meaning |
|---|---|---|
| `--registry` | one of the two | Path to the registry Markdown (repository ready) |
| `--modules-dir` | one of the two | Path to the `docs/modules` folder (repository partly ready) |
| `--query` | yes | Free text to rank against |

`--registry` and `--modules-dir` are a required mutually exclusive pair.

| Exit | When | Output |
|---|---|---|
| 0 | Source read and at least one row (for `--modules-dir`) | JSON list on stdout; `[]` means nothing matched the query |
| 1 | Registry missing or unreadable (`OSError`) | `{"ok": false, "error": "<message>"}` on stderr, nothing on stdout |
| 1 | Modules folder missing or not a folder | `{"ok": false, "error": "modules folder not found: <path>"}` on stderr, nothing on stdout |
| 1 | Modules folder with no area that has a non-empty summary | `{"ok": false, "error": "no module summaries were found in <path>"}` on stderr, nothing on stdout (never an empty list that looks valid) |
| 2 | Both or neither of `--registry` and `--modules-dir`, or no `--query` | `argparse` usage error on stderr |

Read-only; writes nothing.

## State Management

None: stateless.

## Error Codes

None. The failures are the exit 1 paths above (the raw `OSError` text, or one of the two fixed messages) and the exit 2 usage error.

## Dependencies

| Kind | Detail |
|---|---|
| Python | Standard library only: `argparse`, `json`, `re`, `sys`, `pathlib` |
| Shared imports | `check_onboarded` (sibling script, for `area_summaries`); not `canonical.py` |
| Declared by skills (`build/skills.yml`) | `ask-project`, `ground-in-project` import `scripts/find_related.py` and `references/paqad-docs-map.md`. Every skill that declares `scripts/find_related.py` must also declare `scripts/check_onboarded.py`, or the import fails in `dist/` |
| Host capability | A tool that runs scripts; otherwise the skills' "If the checks cannot run" checklist picks candidates by hand (PLG-6). A tool that reads repository files, or the user attaching `docs/` (GRD-3) |

## Configuration

None. Module constants: `MIN_TERM = 3`, `HEADING_PREFIX = "# "`, and the two error message formats `NO_SUMMARIES` and `NOT_A_FOLDER`.

## Testing Entry Points

| File | Tests |
|---|---|
| `tests/scripts/test_find_related.py` | Registry path: `ParseTest`, `RankTest` (obvious module, determinism, no match, registry-order ties, output fields), `CliTest` (missing registry exits 1, a written registry). Modules-folder path: `ModulesDirRowsTest` (real fixture rows match the registry row shape, missing and empty summaries skipped, `plain_name` from the first heading or the folder name, a missing folder gives no rows, deterministic ranking with sorted-folder ties), `ModulesDirCliTest` (ranked list on the fixture, no match is `[]` with exit 0, missing folder, a file path and a folder without summaries each exit 1 with stdout empty, both or neither source and a missing query exit 2) |

Eval scenarios that exercise grounding through the entry skills: `s1.yml` `ac-5`, `ac-21`, `ac-22`, `ac-26`, `ac-46`, and `repo-selection.yml` `ac-55` (partly ready ranking) (declarative, not yet run in CI).
