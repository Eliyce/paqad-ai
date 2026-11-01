# S5 evals

verified: 2026-11-01

1. Write at least two cases under `evals/<case>/`, each with `case.yaml` (`repo_state`, `inputs`, `expected`) and `prompt.md`. A reviewer gets a planted defect and a clean input.
2. Run `paqad-ai agent eval plan <name>`. It prints the worst-case spend first, then the trials: each case, each arm (`with_agent`, the baseline, and `with_agent_memory` for a memory candidate), each tier, three trials. From iteration two, name the lever with `--lever`.
3. Run every trial in a fresh context on a clean copy of the case's repo state, under the spend cap, and save `<workdir>/outputs/`, `grading.json` and `timing.json` in its workdir.
4. Run `paqad-ai agent eval record <name>`.

The gate is pass^3 at `agent_pass_k_threshold` (stage agents use `agent_stage_pass_k_threshold`) on the cheapest passing tier, a gain over the baseline, and a cost within `agent_max_cost_multiple`. An edited agent passes when nothing regresses beyond `authoring_regression_tolerance`.

Revise in this order: the delegation brief, the tools, the stopping rules, the report, then the prose. A trial that hit `maxTurns` or the spend cap fails, and the next revision starts with the stopping rules. The loop stops at the iteration cap or after two iterations with no gain.
