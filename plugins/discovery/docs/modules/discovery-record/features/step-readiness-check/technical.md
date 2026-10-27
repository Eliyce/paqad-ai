# Step readiness check: technical

## Module Boundaries

Owned path: `shared/scripts/check_record.py`. It imports `REQUIRED`, `MODE_REQUIRED`, `present` and `required_for` from `record.py` instead of holding copies (RULE-11).

## Data Contracts

Input: a record JSON file (see [record-lifecycle](../record-lifecycle/technical.md)). Output: `{"ok": bool, "issues": [{"code", "path", "message"}]}`, where `path` is `"step <n> -> <block>"` for block issues.

## Script Interfaces

`check_record.py --path <record.json> [--step <n>]` (step defaults to `run.step`). Read-only, standard library, no network.

| Exit | Meaning |
|---|---|
| 0 | No issues |
| 1 | At least one issue |

There is no error wrapper: an unreadable or non-JSON file raises an uncaught Python exception.

## State Management

- Mode from `run.mode` (default `build`). Build mode uses `REQUIRED` by step; other modes index `MODE_REQUIRED` by step, and a step past the sequence requires nothing.
- `present`: non-empty container or non-whitespace string.
- A block in `stale` that is present reports `STALE`; an absent or empty one reports `MISSING`.
- Writes nothing.

## Error Codes

| Code | Meaning |
|---|---|
| `RECORD` | The record has no `run` block |
| `STEP` | Build mode with a step not in `REQUIRED` |
| `MISSING` | A required block is missing or empty |
| `STALE` | A required block is present but listed in `stale` |

## Dependencies

| Kind | Dependency |
|---|---|
| Python imports | `canonical` (`load`, `issue`, `result`), `record` |
| Build | Declared as `scripts/check_record.py` for product-discovery, refine-ticket, size-work, plan-sprint |

## Configuration

None.

## Testing Entry Points

`tests/scripts/test_check_record.py`:

- `ResumeSignalTest` (AC-15): `test_every_step_starts_missing_then_passes_when_filled`, `test_present_but_stale_block_is_flagged_stale`, `test_partly_filled_step_flags_only_the_empty_block`
- `GuardTest`: `test_missing_run_block_reported`, `test_unknown_step_reported`, `test_step_defaults_to_run_step`
- `SyncGuardTest`: `test_required_map_is_the_one_in_record`
- `CliTest`: `test_cli_exit_1_and_issue_when_required_block_missing`, `test_cli_exit_0_when_required_block_present`
- `ModeAwareCheckTest`: `test_refine_mode_flags_the_step_block_missing_then_passes`, `test_size_and_plan_modes_gate_their_block`, `test_refine_mode_present_but_stale_block_is_flagged`, `test_mode_required_is_imported_from_record`

Eval: `tests/evals/scenarios/s1.yml#ac-15`.
