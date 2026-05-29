# Rule-script runner contract

How `feature-development.checks` consumes the rules-as-scripts gate (issue #89).

## Modes (`checks.rule_compliance.mode`)

| Mode     | Behavior                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------- |
| `off`    | The runner is not invoked at all.                                                                     |
| `warn`   | Run, write `report.json`, never fail the stage (exit 0).                                              |
| `strict` | Run; fail the stage (exit 1) on any `deterministic` finding. `heuristic` findings stay informational. |

`strict` is the default.

## Finding routing

| Finding `kind`  | Stage                                         | Blocks?                   |
| --------------- | --------------------------------------------- | ------------------------- |
| `deterministic` | `checks`                                      | yes, under `mode: strict` |
| `heuristic`     | `review` (fed alongside `adversarial-review`) | never                     |

## Diff-scoping

`scope: changed-files` (the default) runs each script only over the working-tree diff. Pass the changed files as trailing args to `run.mjs`. When no diff is provided, or `scope: whole-tree`, the runner enumerates source files itself. The report is cached on `rule_files_hash × script_files_hash × target_files_hash`, so an unchanged tree re-uses the prior report rather than re-running every script.

## Missing dependencies

A script header may declare `requires: {"binaries":["git"]}`. If a declared binary is absent on the running machine, that single script is skipped with a `missing dependency: <bin>` result — the stage is never crashed. Other scripts still run.

## Exit codes

- `0` — stage may proceed (mode `off`/`warn`, or `strict` with zero deterministic findings).
- `1` — `mode: strict` and at least one `deterministic` finding blocks the stage.
