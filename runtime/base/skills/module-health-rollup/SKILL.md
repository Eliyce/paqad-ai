---
name: module-health-rollup
description: "Rolls up test-driven module health: parses the stack pack's coverage and test reports, attributes rows to modules through module-map.yml, and writes .paqad/module-health records with blocked_metrics for signals it could not compute. Use when checks finish, when module-health sync runs with a report, or when the user asks to refresh module health or roll up coverage."
metadata:
  model_tier: medium
  cacheable: 'false'
  output_format: markdown
  paqad-meta: skill.meta.yaml
---

## What It Does

Runs the test-driven module-health rollup. For every module declared in `module-map.yml`, the rollup computes:

| Metric               | Source                                                          |
| -------------------- | --------------------------------------------------------------- |
| `coverage_pct`       | Coverage report parsed via the pack's `coverage_format` parser. |
| `tests_passing`      | Test report parsed via the pack's `test_report_format` parser.  |
| `tests_failing`      | Same.                                                           |
| `tests_total`        | Same.                                                           |
| `change_velocity`    | `git log -- <sources>` over `git_window_days` (default 14).     |
| `contract_stability` | `public_api_extractor` output. Blocked when extractor absent.   |

Coverage and test rows are attributed to module slugs by matching each file against `module-map.yml`'s `sources:` globs. Files that match no module land in the report's `unattributed_files` list (surfaced to the user as a `MM-ADD` candidate for the reconciler).

Hard rule: no metric is fabricated or zeroed. When a signal cannot be computed the metric is set to `null` and the reason recorded in `blocked_metrics` (e.g. `coverage:not_configured`, `tests:report_missing:<path>`, `contract_stability:no_public_api_extractor`).

## Use This When

- `feature-development.checks` finishes format/test/build and needs to refresh module health.
- `paqad-ai module-health sync --from-report <path>` is invoked.
- The provider hook at `runtime/hooks/module-health-sync.sh` fires.
- A user prompt asks to "refresh module health" or "roll up coverage".

## Inputs

- The active stack pack's `module_health` block: see `references/coverage-formats.md` for the closed format set. Required: `source_roots`, plus at least one of `(coverage_format + coverage_path)` or `(test_report_format + test_report_path)`.
- `module-map.yml` (read-only) for slug attribution.
- Optional `--from-report <path>` to bypass the pack's report path (typical in CI).

## Procedure

1. Resolve the active stack pack and read its `module_health` block. If the block is absent, hard-fail with `blocked: module_health_unknown` and surface a Decision Pause packet asking the user to add it to the pack.
2. Invoke the TS engine via the bundled wrapper:
   ```
   bash scripts/rollup.sh [project-root] [--from-report <path>]
   ```
   The wrapper shells out to `paqad-ai module-health rollup --project-root <root> [--from-report <path>]`. Omit `--from-report` to run off the declared report paths in the pack.
3. Parse the resulting `RollupReport`. Group findings by module.
4. For each module, surface any `blocked_metrics` entries to the user as informational warnings (not Decision Pause packets: these are config gaps, not choices).
5. For `unattributed_files`, route the user to the module-map reconciler (`MM-ADD` candidates).

## Output Contract

- Per-module records written to `.paqad/module-health/<slug>.json` in the schema-v2 shape with `blocked_metrics: string[]` and `evidence.rollup` populated.
- A `## Module Health Rollup` markdown block listing each module, its tier, and any `blocked_metrics` reasons.
- A `## Unattributed Coverage Files` block listing files that landed on no module slug.

## Escalate / Stop Conditions

- Hard-fail with `blocked: module_health_unknown` when the active stack pack does not declare a `module_health` block.
- Stop and route to the module-map reconciler when `unattributed_files` is non-empty: coverage for an undeclared module is a `MM-ADD` candidate.
- Do **not** invent `contract_stability` when the pack has no `public_api_extractor`. Record `contract_stability:no_public_api_extractor` in `blocked_metrics` and continue.

## Scripts

Deterministic plumbing: do **not** re-derive these in the LLM layer.

- `scripts/rollup.sh [project-root] [--from-report <path>]`: invoke the rollup; writes `.paqad/module-health/<slug>.json` per declared module and prints the rollup report JSON.
- `scripts/is-blocked.sh [report.json|-]`: exit 1 with the blocked reason on stdout when the whole rollup is blocked (typically `module_health_unknown`).
- `scripts/list-blocked-metrics.sh [report.json|-]`: sorted `<slug>: <reason>, <reason>` lines for the informational warnings the skill surfaces.
- `scripts/list-unattributed.sh [report.json|-]`: sorted file paths for the `## Unattributed Coverage Files` block; these are `MM-ADD` candidates for the module-map reconciler.

## Assets

- `assets/templates/rollup-summary.md`: markdown template for the `## Module Health Rollup` + `## Unattributed Coverage Files` blocks.

## Resources

- `references/coverage-formats.md`: supported formats + the no-fabricated-metrics contract.
- `runtime/base/skills/module-health-rollup/agents/openai.yaml`: agent interface metadata.
- `src/module-health/rollup.ts`: rollup engine.
- `src/module-health/parsers/`: the nine framework-shipped parsers.
- `src/validators/schemas/stack-pack.schema.json`: closed enum for `coverage_format` / `test_report_format`.
- `runtime/base/skills/module-map-reconciler/SKILL.md`: sibling skill that consumes `unattributed_files` as `MM-ADD` candidates.
- the Decision Pause Contract (in the framework bootstrap): packet semantics.
