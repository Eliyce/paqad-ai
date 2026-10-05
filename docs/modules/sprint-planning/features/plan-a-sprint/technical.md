# Plan a sprint: technical

## Module Boundaries

Owned paths:

- `skills/plan-sprint/SKILL.md`
- `skills/plan-sprint/references/sprint-procedure.md`
- `skills/plan-sprint/scripts/fit_sprint.py`

Shared files copied in at build time (declared in `build/skills.yml`, owned elsewhere): `references/voice.md`, `references/tracker-profiles/jira.md`, `scripts/canonical.py`, `scripts/record.py`, `scripts/check_record.py`, `scripts/check_readback.py`.

## Data Contracts

`plan` inputs (from the script docstring):

```text
candidates.json: {"sprints": [{"id", "state": "future"|..., "settable": bool}],
                  "candidates": [{"ref", "priority", "size", "checks_pass": bool,
                                  "dependencies": [{"ref", "done": bool, "in_sprint": bool}]}]}
history.json:    {"sprints": [{"id", "delivered": <number>} x3]}
```

`plan` output:

```text
{"ok", "sprint", "capacity": {"value", "derived_from": [{"sprint", "count"}]}, "goal",
 "fitting": [refs], "stretch": [refs], "left_out": [{"ref", "reason"}], "total", "risks": [...],
 "not_ready": [{"ref", "needs"}], "by_hand": bool, "digest"}
```

No future sprint: `{"ok": false, "sprint": null, "reason", "created": []}`.

`apply` output: `{"ok", "applied": [refs], "operations": [{"op": "set_sprint_field", "ref", "sprint"}], "read_back": {"status": "match"|"partial"|"mismatch", "confirmed", "missing"}}`. Mismatch: `{"ok": false, "error", "expected", "actual", "applied": []}`.

Optional `--tracker-state` input: a JSON object of `ref -> sprint value` read after the host wrote the field.

Record block: `sprint_plan` (plan mode). SKILL.md lists the sprint, capacity with `derived_from`, goal, chosen and stretch tickets, left-out with reasons, total, risks, `by_hand`, and the plan digest. No schema file defines it.

## Script Interfaces

`fit_sprint.py` (standard library, Python 3.9+, no network, writes only to stdout):

| Subcommand | Args | Behaviour | Exit |
|---|---|---|---|
| `plan` | `--sprint-field <id>`, `--candidates`, `--history` (required), `--target-sprint` (optional) | Target is the named sprint if it is in a future state, else the first sprint whose state is `future`, `planned` or `upcoming`. Capacity value is the rounded mean of `delivered` over the last three history entries. Readiness: `checks_pass`, non-empty non-zero `size`, every dependency `done` or `in_sprint`. Ready candidates sorted by `priority` (missing = last), then `ref`; greedily fitted while total <= capacity, else stretch while total + size <= capacity x 1.25, else left out with "Beyond the sprint capacity of N.". `by_hand` is true when the sprint is not `settable` or `--sprint-field` is empty. | 0 plan, 1 no future sprint |
| `apply` | `--plan`, `--expect-digest` (required), `--tracker-state` (optional) | Recomputes the plan digest and refuses on mismatch. Emits one `set_sprint_field` operation per `fitting` ref and nothing else (SPR-7). Read-back compares refs with `check_readback.norm_ref` against tracker state. It does not call the tracker: the host performs the write. | 0 applied, 1 mismatch |

Errors of type `ValueError`, `OSError`, `KeyError` or `TypeError` print `{"ok": false, "error"}` to stderr and exit 1.

## State Management

- Record mode is `plan`. `record.MODE_REQUIRED["plan"]` is `("sprint_plan",)`; no mode chain, so writing it stales nothing.
- `sprint_plan` is in `record.APPROVABLE`: `record.py approve --block sprint_plan --message-ref <ref>` binds `{block, digest, message_ref}` where the digest is `record.block_digest` (canonical digest of the block minus `digest`). Any later `update` sets `approval` to null (REC-7).
- `fit_sprint.plan_digest` is `canonical.digest` over the plan minus `digest` and `ok`. The `apply` refusal uses this digest, so an edited goal or list voids the approval (`test_edit_after_approval_voids_digest`).
- Read-back status: `match` when every chosen ref is confirmed, `partial` when some are, `mismatch` when none are (including when no tracker state is supplied).

## Error Codes

None as structured codes. Text reasons: "No future sprint exists. A sprint is created by the team in the tracker..." (plan, exit 1); "The plan digest does not match the approved digest; refusing to apply." (apply, exit 1). Readiness `needs` strings: "its checks to pass", "a size", "dependency <ref> done or in the sprint".

## Dependencies

| Kind | Dependency |
|---|---|
| Shared imports (`build/skills.yml`) | `references/voice.md`, `references/tracker-profiles/jira.md`, `scripts/canonical.py`, `scripts/record.py`, `scripts/check_record.py`, `scripts/check_readback.py` |
| Python imports | `canonical` (`load`, `digest`), `check_readback` (`norm_ref`) |
| Modules | [discovery-record](../../../discovery-record/index/summary.md), [tracker-checks](../../../tracker-checks/index/summary.md), [conversation-standards](../../../conversation-standards/index/summary.md) |
| Hand-off | Unready tickets point to `refine-ticket` or `size-work` |
| Host capabilities | Tracker connector to read board sprints, issues and history, and to set the sprint field; file creation for the record |

## Configuration

- Constants in `fit_sprint.py`: `STRETCH_FACTOR = 1.25`, `FUTURE_STATES = ("future", "planned", "upcoming")`.
- Sprint field id: `setup.sprint_field_id`, resolved per site from the Jira profile.

## Testing Entry Points

`tests/scripts/test_sprint.py`:

- `PlanTest`: `test_derived_capacity_and_full_plan` (AC-38), `test_readiness_filter_flags_no_size_and_external_dep` (AC-39), `test_unsettable_field_returns_by_hand_plan` (U-14)
- `NoFutureSprintTest`: `test_no_future_sprint_reports_and_creates_nothing` (AC-41)
- `ApplyTest`: `test_apply_sets_only_chosen_with_readback` (AC-40), `test_apply_only_sets_sprint_field_never_other_ops` (SPR-7), `test_digest_mismatch_refuses` (SPR-6), `test_edit_after_approval_voids_digest`

Also: `tests/scripts/test_record.py` `SizeAndPlanModeTest.test_plan_mode_requires_sprint_plan`, `ApprovalTest.test_sprint_plan_approval_digest`; `tests/scripts/test_check_record.py` `ModeAwareCheckTest.test_size_and_plan_modes_gate_their_block`; `tests/scripts/test_authoring.py` entry-skill and checklist-fallback checks. Eval: `tests/evals/scenarios/s1b.yml#ac-38` (fixture `tracker/Sprint 24`).
