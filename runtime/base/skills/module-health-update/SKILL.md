---
name: module-health-update
description: 'Refreshes health for every declared module in one pass: the test-driven rollup, then the session-evidence sync, through the existing module-health rollup and sync verbs. Use when the user asks to update or check module health, after a batch of changes, or when a module still holds its onboarding stub.'
metadata:
  model_tier: fast
  cacheable: 'false'
  output_format: markdown
  paqad-meta: skill.meta.yaml
---

## What It Does

Refreshes the health of **every** module in the project in a single pass, combining the two complementary update paths so a profile is never left frozen at its onboarding stub:

| Pass       | Source                                                                                                                 | Fields it updates                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **rollup** | The active stack pack's declared coverage + test reports, attributed to modules via `module-map.yml` `sources:` globs. | `coverage_pct`, `tests_passing`, `tests_failing`, `tests_total`, `change_velocity` |
| **sync**   | Pending session evidence + the changed-files list + verification status.                                               | `defect_frequency`, `contract_stability`, verification status, tier                |

Order matters: rollup first (report context), sync second (diff + verification context). The two write to different fields of the same `.paqad/module-health/<slug>.json` record and never conflict.

This is the on-demand counterpart to the automatic refresh that the verification backstop performs on every completion. Run it when you want to recompute everything at once.

## Use This When

- A user prompt matches the priority-225 router rules (`update module health`, `refresh module health`, `update all module health`, `update modules health`, `check module health`, `recompute module health`).
- You have just landed a batch of changes and want every touched module's tier brought current before reporting.
- A module's profile still reads `tier: unknown` with all metrics `null` (the onboarding stub) and you want to populate it.

## Inputs

- The active stack pack's `module_health` block: declares `source_roots` plus the coverage / test report formats and paths. When absent, the rollup pass records `blocked: module_health_unknown` and is skipped; the sync pass still runs.
- `module-map.yml` (read-only) for slug attribution.
- Pending evidence under `.paqad/module-health-evidence/` and the changed-files list, consumed by the sync pass.

## Procedure

This skill carries the orchestration logic only. The deterministic plumbing lives in `scripts/` and the output shape lives in `assets/templates/`: do **not** re-derive either in the LLM layer.

1. Run the refresh, which runs both existing CLI verbs in order and emits one combined JSON object `{ "rollup": <report>, "sync": <result> }`:
   ```
   bash scripts/refresh.sh [project-root]
   ```
   It shells out to `paqad-ai module-health rollup --project-root <root>` then `paqad-ai module-health sync --project-root <root>`. No new command is introduced.
2. Pipe that JSON through the helper scripts rather than parsing it yourself:
   - `scripts/is-blocked.sh`: was the rollup pass blocked (`module_health_unknown`)? Informational only; the sync pass still ran.
   - `scripts/list-blocked-metrics.sh`: per-module `blocked_metrics` warnings (config gaps, not Decision Pause packets).
   - `scripts/list-updated.sh`: slugs the sync pass moved this run.
   - `scripts/list-unattributed.sh`: `MM-ADD` candidates for the module-map reconciler.
3. Read back `.paqad/module-health/<slug>.json` for every module to get each resulting `tier`.
4. Render the summary by filling `assets/templates/update-summary.md` with the helper output. Do not hand-write the table.
5. For any `unattributed_files`, route the user to the module-map reconciler (`MM-ADD` candidates).

## Output Contract

- Per-module records written to `.paqad/module-health/<slug>.json` in the schema-v2 shape.
- A `## Module Health Update` block and a `## Unattributed Coverage Files` block, both rendered from `assets/templates/update-summary.md`, never authored inline.

## Escalate / Stop Conditions

- Never fabricate or zero a metric. When a signal cannot be computed it stays `null` with the reason in `blocked_metrics`: surface it, do not invent a value.
- Do **not** add a new `paqad-ai` command for this workflow. It wraps the existing `rollup` and `sync` verbs only.

## Scripts

Deterministic plumbing: do **not** re-derive these in the LLM layer.

- `scripts/refresh.sh [project-root]`: runs rollup then sync; always exits 0 so a blocked rollup never aborts the sync pass; prints `{ rollup, sync }` JSON.
- `scripts/is-blocked.sh [report.json|-]`: exit 1 with the rollup blocked reason on stdout, else exit 0 + `none`.
- `scripts/list-blocked-metrics.sh [report.json|-]`: sorted `<slug>: <reason>, <reason>` lines.
- `scripts/list-updated.sh [report.json|-]`: sorted slugs the sync pass updated.
- `scripts/list-unattributed.sh [report.json|-]`: sorted unattributed file paths (`MM-ADD` candidates).

## Assets

- `assets/templates/update-summary.md`: markdown template for the `## Module Health Update` + `## Unattributed Coverage Files` blocks.

## Resources

- `references/update-vs-rollup.md`: how this whole-project refresh relates to the narrower rollup and sync paths.
- `runtime/base/skills/module-health-update/agents/openai.yaml`: agent interface metadata.
- `runtime/base/skills/module-health-rollup/SKILL.md`: the lower-level rollup-only skill this workflow builds on.
- `src/module-health/rollup.ts`: the rollup engine.
- `src/planning/module-health-updater.ts`: the evidence sync engine.
- `runtime/base/skills/module-map-reconciler/SKILL.md`: sibling skill that consumes `unattributed_files` as `MM-ADD` candidates.
