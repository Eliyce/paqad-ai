---
name: module-health-rollup
description: Test-driven module-health rollup. Issue #80, Phase 3. Reads the active stack pack's module_health block, parses the declared coverage and test reports (or one provided via --from-report), attributes rows to module slugs via module-map.yml's source globs, computes per-module coverage_pct / tests_passing / tests_failing / tests_total / change_velocity, and writes the extended .paqad/module-health/<slug>.json record with blocked_metrics populated for any signal that could not be computed. The TS engine lives in `src/module-health/rollup.ts`; this skill is the agent-side wrapper that invokes it via the CLI and surfaces blocked-metric reasons.
model_tier: medium
triggers:
  - workflow:
      - feature-development
      - module-health-rollup
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  project_root:
    type: path
    required: false
    description: Project root used to resolve module-map.yml and the active stack pack. Defaults to cwd.
  from_report:
    type: path
    required: false
    description: Path to a pre-generated coverage report. Skips test_command and uses this file as the coverage source.
  test_report:
    type: path
    required: false
    description: Path to a pre-generated test report (junit-xml / go-json / vitest-json). Skips test_command and uses this file as the test source.
  run_test_command:
    type: boolean
    required: false
    description: When true, run the pack's `test_command` before reading reports. Off by default in CI / from-report flows.
---

## What It Does

Runs the test-driven module-health rollup defined by issue #80, Phase 3. For every module declared in `module-map.yml`, the rollup computes:

| Metric              | Source                                                           |
| ------------------- | ---------------------------------------------------------------- |
| `coverage_pct`      | Coverage report parsed via the pack's `coverage_format` parser.  |
| `tests_passing`     | Test report parsed via the pack's `test_report_format` parser.   |
| `tests_failing`     | Same.                                                            |
| `tests_total`       | Same.                                                            |
| `change_velocity`   | `git log -- <sources>` over `git_window_days` (default 14).      |
| `contract_stability`| `public_api_extractor` output. Blocked when extractor absent.    |

Coverage and test rows are attributed to module slugs by matching each file against `module-map.yml`'s `sources:` globs. Files that match no module land in the report's `unattributed_files` list (surfaced to the user as a `MM-ADD` candidate for the reconciler).

Hard rule: no metric is fabricated or zeroed. When a signal cannot be computed the metric is set to `null` and the reason recorded in `blocked_metrics` (e.g. `coverage:not_configured`, `tests:report_missing:<path>`, `contract_stability:no_public_api_extractor`).

## Use This When

- `feature-development.checks` finishes format/test/build and needs to refresh module health.
- `paqad-ai module-health sync --from-report <path>` is invoked.
- The provider hook at `runtime/hooks/module-health-sync.sh` fires.
- A user prompt asks to "refresh module health" or "roll up coverage".

## Inputs

- The active stack pack's `module_health` block — see `runtime/base/skills/module-health-rollup/references/coverage-formats.md` for the closed format set. Required: `source_roots`, plus at least one of `(coverage_format + coverage_path)` or `(test_report_format + test_report_path)`.
- `module-map.yml` (read-only) for slug attribution.
- Optional `--from-report <path>` to bypass the pack's report path (typical in CI).

## Procedure

1. Resolve the active stack pack and read its `module_health` block. If the block is absent, hard-fail with `blocked: module_health_unknown` and surface a Decision Pause packet asking the user to add it to the pack.
2. Invoke the TS engine via the CLI:
   ```
   paqad-ai module-health sync --from-report <path>
   ```
   or, when running off the declared report paths, call the engine without `--from-report`.
3. Parse the resulting `RollupReport`. Group findings by module.
4. For each module, surface any `blocked_metrics` entries to the user as informational warnings (not Decision Pause packets — these are config gaps, not choices).
5. For `unattributed_files`, route the user to the module-map reconciler (`MM-ADD` candidates).

## Output Contract

- Per-module records written to `.paqad/module-health/<slug>.json` in the schema-v2 shape with `blocked_metrics: string[]` and `evidence.rollup` populated.
- A `## Module Health Rollup` markdown block listing each module, its tier, and any `blocked_metrics` reasons.
- A `## Unattributed Coverage Files` block listing files that landed on no module slug.

## Escalate / Stop Conditions

- Hard-fail with `blocked: module_health_unknown` when the active stack pack does not declare a `module_health` block.
- Stop and route to the module-map reconciler when `unattributed_files` is non-empty — coverage for an undeclared module is a `MM-ADD` candidate.
- Do **not** invent `contract_stability` when the pack has no `public_api_extractor`. Record `contract_stability:no_public_api_extractor` in `blocked_metrics` and continue.

## Resources

- `runtime/base/skills/module-health-rollup/references/coverage-formats.md` — supported formats + the no-fabricated-metrics contract.
- `runtime/base/skills/module-health-rollup/agents/openai.yaml` — agent interface metadata.
- `src/module-health/rollup.ts` — rollup engine.
- `src/module-health/parsers/` — the nine framework-shipped parsers.
- `src/validators/schemas/stack-pack.schema.json` — closed enum for `coverage_format` / `test_report_format`.
- `runtime/base/skills/module-map-reconciler/SKILL.md` — sibling skill that consumes `unattributed_files` as `MM-ADD` candidates.
- `.paqad/decision-pause-contract.md` — packet semantics.
