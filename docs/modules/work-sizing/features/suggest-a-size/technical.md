# Suggest a size: technical

## Module Boundaries

Owned paths:

- `skills/size-work/SKILL.md`
- `skills/size-work/references/sizing-guide.md`
- `skills/size-work/scripts/compare_sizes.py`

Shared files copied in at build time (declared in `build/skills.yml`, owned elsewhere): `references/voice.md`, `references/tracker-profiles/jira.md`, `scripts/canonical.py`, `scripts/record.py`, `scripts/check_record.py`.

## Data Contracts

`suggest` inputs (JSON files, read with `canonical.load`):

| Input | Shape |
|---|---|
| `--target` | `{"key", "summary", "description", "labels": [..]}` |
| `--pool` | `[{"key", "link", "size", "summary", "description", "labels": [..]}, ...]` (finished tickets) |
| `--scale` | `{"scale": ["XS", "S", "M", "L", "XL"]}` or a bare list, ordered smallest to largest |
| `--area-docs` | Optional plain text or Markdown file of the target area's docs |

`suggest` output:

```json
{"ok": true, "suggestion": {"size": "M", "range": null, "drivers": ["Shares export, returns with DONE-1"],
  "confidence": "high", "confidence_reason": "Based on 3 comparable finished tickets.",
  "comparables": [{"key": "DONE-1", "link": "https://...", "size": "M"}], "label": "suggested size"}}
```

`set` output: `{"ok": bool, "write": bool, "reason": str}`.

Record block: `sizing` (filled in size mode). SKILL.md lists its content as the scale, the target ticket, the two to five comparables (key, link, size) and the suggestion (size, range, drivers, confidence, confidence reason). No schema file defines it; `record.py` accepts any JSON value for the block.

## Script Interfaces

`compare_sizes.py` (standard library, Python 3.9+, no network, writes only to stdout):

| Subcommand | Args | Behaviour | Exit |
|---|---|---|---|
| `suggest` | `--target`, `--pool`, `--scale` (required), `--area-docs` (optional) | Scores each pool ticket by Jaccard overlap of lowercased, stopword-free tokens from summary, description and labels; keeps up to five with a positive score (score desc, then key asc). Fewer than two: `size` and `range` null, confidence `low`. Otherwise size is the most common comparable size; confidence `high` only when all agree and there are at least three, else `medium`. Disagreement gives `range` `[lowest, highest]` by scale order and lowers confidence one notch. Template or empty area docs lower it one more notch. Drivers are `"Shares <tokens> with <key>"` from summary and label overlap. | 0 |
| `set` | `--field-value <current>` (default empty), `--replace` | Write allowed when the field is empty (blank strings count as empty) or `--replace` is given; refused otherwise. Performs no write itself. | 0 allowed, 1 refused |

Any `ValueError`, `OSError`, `KeyError` or `TypeError` prints `{"ok": false, "error": <msg>}` to stderr and exits 1. Argparse usage errors exit 2.

## State Management

- Record mode is `size` (`record.py init --mode size`). `record.MODE_REQUIRED["size"]` is `("sizing",)`: step 0 requires `sizing`; `advance` moves to step 1, the final step for this mode.
- `sizing` is not in the build `CHAIN` or any `MODE_CHAIN`, so writing it stales nothing, and it is not in `APPROVABLE`: it carries no approval digest (SKILL.md Output).
- Writes go through `record.py update --expect-revision`; readiness through `check_record.py` (size mode).
- The team scale is to be remembered in the record (EST-1). Which block holds it beyond `sizing` and `setup.size_field_id` is not determinable from the source.

## Error Codes

None as structured codes. Text reasons from `set`: refused overwrite ("already holds a value; refusing to overwrite"), allowed with replace, allowed on empty. `suggest` reports a thin basis through `confidence_reason` ("Fewer than two comparable finished tickets...").

## Dependencies

| Kind | Dependency |
|---|---|
| Shared imports (`build/skills.yml`) | `references/voice.md`, `references/tracker-profiles/jira.md`, `scripts/canonical.py`, `scripts/record.py`, `scripts/check_record.py` |
| Python imports | `canonical` (`load`, `text`) |
| Modules | [discovery-record](../../../discovery-record/index/summary.md), [tracker-checks](../../../tracker-checks/index/summary.md) (Jira profile), [conversation-standards](../../../conversation-standards/index/summary.md) |
| Hand-off | Points users to `refine-ticket` for splits (EST-4) |
| Host capabilities | Tracker connector to search finished tickets, read the size field, add a comment and write the field; file creation for the record |

## Configuration

- Constants in `compare_sizes.py`: `LABEL = "suggested size"`, `CONFIDENCE_ORDER`, `STOPWORDS`, `TEMPLATE_MARKERS` (todo, tbd, lorem ipsum, fill in, describe the, coming soon, placeholder, `<describe`, `<add`, xxx). The template check is local, so it does not use `detect_placeholder.py`.
- Size field id: `setup.size_field_id`, resolved per site from the Jira profile.

## Testing Entry Points

`tests/scripts/test_sizing.py`:

- `SuggestTest`: `test_returns_comparables_drivers_confidence_label_and_no_write` (AC-35), `test_disagreeing_comparables_give_a_range_and_lower_confidence`, `test_high_confidence_when_three_agree`
- `TemplateDocsTest`: `test_template_area_docs_lower_confidence_with_reason` (AC-36), `test_is_template_docs_detects_empty_and_markers`
- `FewComparablesTest`: `test_fewer_than_two_comparables_reports_and_invents_nothing` (EST-2/3)
- `SetGuardTest`: `test_refuses_overwrite_of_populated_field_without_replace` (AC-37), `test_allows_overwrite_with_replace`, `test_allows_write_on_empty_field`
- `CliExitTest`: `test_set_on_populated_field_exits_one`, `test_set_with_replace_exits_zero`

Also: `tests/scripts/test_record.py` `SizeAndPlanModeTest.test_size_mode_requires_sizing`; `tests/scripts/test_check_record.py` `ModeAwareCheckTest.test_size_and_plan_modes_gate_their_block`; `tests/scripts/test_authoring.py` entry-skill and checklist-fallback checks. Eval: `tests/evals/scenarios/s1b.yml#ac-35` (fixture `tracker/SUB-70`).
