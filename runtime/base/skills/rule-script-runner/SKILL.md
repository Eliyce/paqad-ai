---
name: rule-script-runner
description: Executes the registered rule scripts diff-scoped during feature-development.checks, aggregates findings into .paqad/scripts/rules/.cache/report.json with hash-cache invalidation, and decides whether the checks stage is blocked (issue #89). No LLM — the TS engine is src/rule-scripts/runner.ts; this skill is the thin agent-side wrapper invoked from the checks stage. deterministic findings block under mode:strict; heuristic findings route to the review stage and never block.
model_tier: fast
triggers:
  - workflow:
      - feature-development
cacheable: false
cache_key_inputs: []
output_format: json
input_schema:
  project_root:
    type: path
    required: false
    description: Project root used to resolve rule-script-map.yml and scripts. Defaults to cwd.
  mode:
    type: string
    required: false
    description: off | warn | strict. Defaults to the checks.rule_compliance.mode in feature-development.yaml.
---

## What It Does

During `feature-development.checks`, runs every script registered in `docs/instructions/rules/rule-script-map.yml` against the changed files (diff-scoped) and aggregates the findings:

- `deterministic` findings → block the `checks` stage under `mode: strict`.
- `heuristic` findings → informational; routed to the `review` stage alongside `adversarial-review`. They never block.
- A script declaring `requires.binaries` that are missing emits a clean "missing dependency" result and is skipped — it never crashes the stage.

Results are written to `.paqad/scripts/rules/.cache/report.json`, hash-cached on `rule_files_hash × script_files_hash × target_files_hash` so unchanged inputs re-use the cached report.

## Use This When

- Invoked from `feature-development.checks` after the project command checks, when `checks.rule_compliance.mode` is `warn` or `strict`.
- Never invoked directly by the user; it is a workflow sub-step.

## Inputs

- `docs/instructions/rules/rule-script-map.yml` (read-only).
- The registered `.paqad/scripts/rules/**/*.mjs` scripts.
- The changed-files list (diff) for `scope: changed-files`; whole-tree enumeration otherwise.
- `checks.rule_compliance.mode` from `feature-development.yaml`.

## Procedure

1. Read `checks.rule_compliance.mode` from `feature-development.yaml`. If `off`, skip entirely.
2. Run the runner:
   ```
   node scripts/run.mjs <project-root> <mode> [changed-file ...]
   ```
   Exit 0 = stage may proceed. Exit 1 = `mode: strict` and a `deterministic` finding blocks the stage.
3. Surface blocking `deterministic` findings as the stage failure with file:line and message. Pass `heuristic` findings to the `review` stage.

## Output Contract

- `.paqad/scripts/rules/.cache/report.json` written (or re-used from cache).
- JSON `RunReport` on stdout: `results`, `counts` (deterministic / heuristic / skipped), and `blocking`.
- Non-zero exit only when `mode: strict` and at least one `deterministic` finding exists.

## Escalate / Stop Conditions

- Under `mode: strict`, stop the `checks` stage on any `deterministic` finding.
- Never block on `heuristic` findings — they inform `review` only.
- A missing declared binary is reported and the single script skipped; the stage is never crashed by it.
- If `rule-script-map.yml` is absent, the runner returns an empty, non-blocking report.

## Resources

- `runtime/base/skills/rule-script-runner/references/run-contract.md` — mode + exit-code + diff-scope contract.
- `runtime/base/skills/rule-script-runner/agents/openai.yaml` — agent interface metadata.
- `src/rule-scripts/runner.ts` — the execution + aggregation + hash-cache engine.
