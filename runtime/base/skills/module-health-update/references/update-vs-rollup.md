# Update vs rollup vs sync

This skill (`module-health-update`) is the whole-project, on-demand refresh. It is deliberately the union of two narrower paths so a single prompt brings every module current.

| Path                    | Skill / engine                                               | What it computes                                                                                                                     | When it runs on its own                                                                              |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **rollup**              | `module-health-rollup` skill → `src/module-health/rollup.ts` | `coverage_pct`, `tests_passing`, `tests_failing`, `tests_total`, `change_velocity` from the pack's declared coverage + test reports. | After `feature-development.checks`, or `paqad-ai module-health rollup`.                              |
| **sync**                | `src/planning/module-health-updater.ts`                      | `defect_frequency`, `contract_stability`, verification status, tier from pending evidence + the changed-files list.                  | `paqad-ai module-health sync`, and automatically from the verification backstop on every completion. |
| **update** (this skill) | `scripts/refresh.sh`                                         | Runs rollup then sync across every module in one pass and reports each resulting tier.                                               | The `update module health` workflow prompt.                                                          |

## Why both passes

A consumer repo that declares no `module_health` block in its stack pack gets `blocked: module_health_unknown` from the rollup, but the sync pass still moves profiles off their onboarding stub using git + verification evidence. A repo that does declare reports gets the full metric set. Running both is always safe: they write disjoint fields of the same profile and never conflict.

## No new command

`update module health` is a routed workflow prompt, not a CLI verb. `scripts/refresh.sh` only ever shells the two pre-existing commands, `paqad-ai module-health rollup` and `paqad-ai module-health sync`.
