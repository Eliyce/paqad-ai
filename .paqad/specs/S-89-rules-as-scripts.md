# S-89 — Rules-as-scripts: deterministic per-project verification of instruction rules

**Tracks:** [Eliyce/paqad-ai#89](https://github.com/Eliyce/paqad-ai/issues/89)
**Lane:** full
**Created:** 2026-05-29

## User Story

As a `paqad-ai` maintainer (and as an onboarded-project user), I want each prose rule under `docs/instructions/rules/**` to be backed — where deterministically possible — by a small, readable verification script that runs as a sub-step of `feature-development.yaml › checks`, so that rule adherence stops depending solely on the model's instruction-following and instead has deterministic teeth that are provider-neutral, project-tunable, and mutation-aware. The whole lifecycle is prompt-driven; no new user-facing CLI commands.

## Current state (verified 2026-05-29 against main @ `a5e350b`)

Verification sweep results — what the issue claims to reuse vs. reality:

- **Hash-cached report** — [src/compliance/compliance-checker.ts](src/compliance/compliance-checker.ts): real. `sha256Hex()` over sorted file paths+contents; compares `spec_hash`/`test_files_hash`; persists via `persistReport()`. **It scans all matching files — there is no diff-scoping today.** The runner's changed-files scope is net-new, not reuse.
- **Single-writer + drift** — [src/module-decisions/apply.ts](src/module-decisions/apply.ts) is the sole writer of `module-map.yml`: atomic temp-write + `renameSync`, pre-mutation snapshot to `.paqad/module-map/history/`. Drift codes `MM-*` defined in [src/module-map/reconciler.ts](src/module-map/reconciler.ts). **There is no lockfile** — atomicity is rename-based. The issue's "same lockfile pattern" claim (open-question #5) is inaccurate; we mirror the rename+snapshot pattern instead.
- **Skill layout** — `SKILL.md` + `agents/` + `assets/` + `references/` + `scripts/` (confirmed against `module-map-reconciler/` and `canonical-doc-sync/`).
- **feature-development.yaml** already has `strictness:`/`escalation:` knobs and `checks` + `review` stages ([docs/instructions/workflows/feature-development.yaml](docs/instructions/workflows/feature-development.yaml)). **The default is rendered in code** by `renderDefaultFeatureDevelopmentPolicyYaml()` in [src/pipeline/feature-development-policy.ts](src/pipeline/feature-development-policy.ts), validated by [src/validators/schemas/feature-development-policy.schema.json](src/validators/schemas/feature-development-policy.schema.json). **There is no `feature-development.yaml.hbs` template** — the issue's "Files to add" path is wrong.
- **Dashboard** — `DASHBOARD_SECTION_IDS` in [src/dashboard/types.ts](src/dashboard/types.ts); existing rules collector [src/dashboard/collectors/rules.ts](src/dashboard/collectors/rules.ts) delegates to `collectDocsArea()`. Collectors registered in `src/dashboard/report.ts`.
- **gitignore-writer** — [src/onboarding/gitignore-writer.ts](src/onboarding/gitignore-writer.ts): idempotent via `# paqad-ai` marker check.
- **pentest vs design-test footprint** — pentest scripts run from `.paqad/pentest/runs/...` (in-project); design-test scripts are framework-owned at `runtime/scripts/design/`. The issue correctly follows the **pentest in-project model**.
- **Finding normalizer** — lives at `runtime/capabilities/security/skills/finding-normalizer/assets/vocabulary.txt` (defines `PEN-`, `DT-`, `MD-`), **not** `runtime/base/skills/finding-normalizer/` as the issue states.
- **Routing-rules format** — [runtime/base/skills/workflow-router/assets/routing-rules.txt](runtime/base/skills/workflow-router/assets/routing-rules.txt) is **tab-separated `priority<TAB>workflow<TAB>pattern`**, not the space-separated `priority code pattern` the issue proposes.
- **Rule markers** — no `<!-- @rule RL-… -->` markers exist yet under `docs/instructions/rules/**`.

## Scope decisions (captured from the planning dialogue, 2026-05-29)

1. **One feature branch, one changeset.** Branch `feat/issue-89-rules-as-scripts`. Commit history structured one logical commit per phase so review can proceed phase-by-phase. Changesets bump: **minor** (additive; projects opt in via `rule_compliance.mode`, default behavior is gated behind first `generate rule scripts` run).
2. **Promote the finding-normalizer to base.** `RS-*` is a cross-capability concern, so the normalizer + vocabulary move from `runtime/capabilities/security/skills/finding-normalizer/` to `runtime/base/skills/finding-normalizer/`. Existing `PEN-`/`DT-`/`MD-` consumers updated to the new location; `RS-*` added there.
3. **Corrections from verification are binding:**
   - Routing rules added in tab-separated `priority<TAB>workflow<TAB>pattern` form.
   - `checks.rule_compliance` block added to the **code renderer** `renderDefaultFeatureDevelopmentPolicyYaml()` and its **schema**, not to a non-existent `.hbs` template.
   - Diff-scoping is implemented in the new runner; it is not inherited from `compliance-checker.ts`.
   - Single-writer for `rule-script-map.yml` mirrors the **rename + snapshot** pattern of `module-decisions/apply.ts` (no lockfile invented).
4. **Map placement:** `docs/instructions/rules/rule-script-map.yml` (team contract, part of the canonical review surface) — matches the issue's lean.
5. **Footprint:** scripts + fixtures + map are checked in under `.paqad/scripts/rules/` and `docs/instructions/rules/rule-script-map.yml`; `.paqad/scripts/rules/.cache/` is gitignored.
6. **Strict from generation.** No shadow mode. A script that passes its fixtures is enforced immediately under `mode: strict`. Default `mode: strict`.
7. **Over-flag guard:** per-kind defaults — `deterministic: 0.05`, `heuristic: 0.20` (matches the issue's lean for open-question #1).

## Constitution waiver

The pre-implementation spec rule in `docs/instructions/rules/_shared/constitution.md` is satisfied by this document. No constitution rule is suspended for this PR.

## Acceptance Criteria

### Phase 0 — finding-normalizer promotion to base
1. `runtime/capabilities/security/skills/finding-normalizer/` moved to `runtime/base/skills/finding-normalizer/`; all references updated; `PEN-`/`DT-`/`MD-` behavior unchanged.
2. `RS-*` code prefix added to `vocabulary.txt` at the new base location.

### Phase 1 — rule IDs + map + analyzer
3. `analyze rules` routes to a new `rule-analyzer` skill across every supported adapter (routing-rules.txt, tab-separated).
4. Running the analyzer embeds an idempotent `<!-- @rule RL-<hash> -->` marker after every rule bullet under `docs/instructions/rules/**`; rerun causes no marker churn. IDs are opaque `RL-<4-hex>`, collision-extended.
5. `analyze rules` produces `docs/instructions/rules/rule-script-map.yml` classifying each rule `deterministic | heuristic | unverifiable`, plus `enforced_by` for rules already covered by ESLint/TS/Prettier/module-health/design-test/pentest.
6. Conflict detection surfaces contradictory rules via the Decision Pause Contract before any script is written.
7. All writes to `rule-script-map.yml` go through a single writer `src/rule-scripts/apply.ts` (rename + snapshot, mirrors `module-decisions/apply.ts`).

### Phase 2 — script + fixture generation
8. `generate rule scripts` (skill `rule-script-generator`) produces one `.mjs` per script under `.paqad/scripts/rules/<mirror>/<rule-filename>/NNN-name.mjs`, each with `__fixtures__/pass/` and `__fixtures__/fail/`. No `.sh` scripts.
9. Each script carries the header contract (validated against `src/rule-scripts/schemas/script-header.schema.json`) and emits the findings JSON contract (validated against `src/rule-scripts/schemas/findings.schema.json`).
10. A script that fails its own fixtures is **rejected**, never registered in the map, and surfaced as a Decision Pause packet. `src/rule-scripts/fixture-runner.ts` is the gate.
11. Over-flag dry-run guard: a new script flagging more than its per-kind threshold of in-scope existing files surfaces via Decision Pause before acceptance.

### Phase 3 — runner + workflow integration
12. `src/rule-scripts/runner.ts` executes scripts diff-scoped, aggregates findings into `.paqad/scripts/rules/.cache/report.json` with hash-cache invalidation (`rule_files_hash × script_files_hash × target_files_hash`).
13. `checks.rule_compliance` block added to `renderDefaultFeatureDevelopmentPolicyYaml()` + schema. `mode: strict` blocks the `checks` stage on any `deterministic` finding; `heuristic` findings route to `review` and never block.
14. A script declaring `requires.binaries: ["git"]` on a machine without git emits a clean "missing dependency" finding and skips only that script — never crashes the stage.

### Phase 4 — reconciler + drift
15. `src/rule-scripts/reconciler.ts` emits `RS-*` drift findings (`RS-RULE-ADDED`, `RS-RULE-EDITED`, `RS-RULE-REMOVED`, `RS-SCRIPT-STALE`, `RS-FIXTURE-FAIL`, `RS-CONFLICT`, `RS-CACHE-INVALID`) to `.paqad/scripts/rules/.cache/drift.json`, surfaced via Decision Pause at planning entry.
16. Hand-editing a rule's markdown without the skill is detected as `RS-RULE-EDITED` and blocks `feature-development` per the project's `escalation.rule_scripts_stale` setting.
17. `rule-editor` skill handles add/edit/remove/downgrade with per-rule cascade (no global rebuild); editing a rule preserves its ID and regenerates only that rule's scripts.

### Phase 5 — dashboard + onboarding
18. `'rule-compliance'` added to `DASHBOARD_SECTION_IDS`; new `src/dashboard/collectors/rule-compliance.ts` reads `report.json` + drift state, registered in `report.ts`. Attention items name the **exact prompt** to type next.
19. `src/onboarding/gitignore-writer.ts` adds `.paqad/scripts/rules/.cache/`; onboarding plants the `generate rule scripts` prompt in next-steps and shows a `rule-compliance` card in `band: unknown` until first run. No scripts seeded at onboard time.

### Cross-cutting
20. No `paqad-ai <command>` is required for any user-facing flow; everything is prompt-driven.
21. The same prompt sequence + skills produce identical artifacts across all supported adapters.
22. `pnpm run ci` passes (lint, types, tests, build).

## Skills introduced (base)

| Skill | Trigger workflow | Role |
|---|---|---|
| `rule-analyzer` | `rules-analyze` | Classify verifiability, embed markers, detect conflicts + existing enforcers, draft the map. |
| `rule-script-generator` | `rules-generate` | Generate `.mjs` + fixtures per rule; strict fixture-pass gate. |
| `rule-editor` | `rules-edit` | add/edit/remove/downgrade single entry point; owns the cascade. |
| `rule-script-reconciler` | invoked from `planning`/`checks` | Drift detection, `RS-*` findings via Decision Pause. |

TS engine lives at `src/rule-scripts/` (parallel to `src/module-map/`, `src/compliance/`). The runner is TS code (no LLM).

## Out of scope / deferred
- Project-overridable thresholds beyond the declared schema.
- Hand-editing generated scripts or `rule-script-map.yml` (round-tripped via skills only).
- Archive retention policy beyond "one `generate rule scripts` cycle" default.
