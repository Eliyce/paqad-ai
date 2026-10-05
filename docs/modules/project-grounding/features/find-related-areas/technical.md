# Find related areas: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `shared/scripts/find_related.py` | `tokens`, `parse_registry`, `term_matches`, `rank`, `main` |
| `shared/references/paqad-docs-map.md` | GRD-1 onboarded rule, GRD-2 reading order table, GRD-5 sources rule |

Not owned here: the onboarded check script (`skills/get-connected/scripts/check_onboarded.py`, idea-journey) and the reading behaviour itself (the `ask-project` and `ground-in-project` skills).

## Data Contracts

Input registry: a Markdown file (target project's `docs/instructions/registries/modules.md`). Every line starting with `|` that splits into at least four cells is a row. Cells are read by position:

| Cell | Read as |
|---|---|
| 0 | `module` (rows where it is empty, equals `module` case-insensitively, or is only `-`, `:` and spaces are skipped) |
| 1 | `plain_name` |
| 2 | `layer` |
| 3 | `features` |

Terms: lowercase alphanumeric tokens of length 3 or more (`MIN_TERM = 3`) from all four cells.

Output (stdout), a JSON list in rank order:

```json
[{"module": "returns", "plain_name": "Returns and refunds", "score": 2, "matched_terms": ["refund", "return"]}]
```

`score` is the count of distinct query terms that match any module term, where a match is equality or a substring either way. Only rows with `score > 0` are returned. Sort is by descending score, ties by registry order.

## Script Interfaces

`find_related.py --registry <modules.md> --query "<idea or question>"`

| Arg | Required | Meaning |
|---|---|---|
| `--registry` | yes | Path to the registry Markdown |
| `--query` | yes | Free text to rank against |

| Exit | When | Output |
|---|---|---|
| 0 | Registry read | JSON list on stdout (may be `[]`) |
| 1 | Registry missing or unreadable (`OSError`) | `{"ok": false, "error": "<message>"}` on stderr |

Read-only; writes nothing.

## State Management

None: stateless.

## Error Codes

None. The only failure is the exit 1 path above, with the raw `OSError` text.

## Dependencies

| Kind | Detail |
|---|---|
| Python | Standard library only: `argparse`, `json`, `re`, `sys`, `pathlib` |
| Shared imports | None (does not import `canonical.py`) |
| Declared by skills (`build/skills.yml`) | `ask-project`, `ground-in-project` import `scripts/find_related.py` and `references/paqad-docs-map.md` |
| Host capability | A tool that runs scripts; otherwise the skills' "If the checks cannot run" checklist picks candidates by hand (PLG-6). A tool that reads repository files, or the user attaching `docs/` (GRD-3) |

## Configuration

None. `MIN_TERM = 3` is a module constant.

## Testing Entry Points

| File | Tests |
|---|---|
| `tests/scripts/test_find_related.py` | `ParseTest.test_parser_skips_header_and_separator`, `RankTest.test_picks_the_obvious_module`, `RankTest.test_ranking_is_deterministic`, `RankTest.test_no_match_returns_empty`, `RankTest.test_ties_fall_back_to_registry_order`, `RankTest.test_output_fields`, `CliTest.test_missing_registry_exits_one`, `CliTest.test_cli_runs_on_a_written_registry` |

Eval scenarios that exercise grounding through the entry skills: `s1.yml` `ac-5`, `ac-21`, `ac-22`, `ac-26`, `ac-46` (declarative, not yet run in CI).
