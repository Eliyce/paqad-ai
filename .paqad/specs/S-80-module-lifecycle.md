# S-80 — Living module lifecycle: prospective decisions + reconciliation + test-driven health

**Tracks:** [Eliyce/paqad-ai#80](https://github.com/Eliyce/paqad-ai/issues/80)
**Supersedes:** #78, #79
**Lane:** full
**Created:** 2026-05-28

## User Story

As a `paqad-ai` maintainer (and as an onboarded-project user), I want `module-map.yml`, `docs/modules/<slug>/**`, and `.paqad/module-health/<slug>.json` to behave as a living, reconciled system — so that new modules cannot be silently introduced, drift between code and the map is surfaced for explicit approval, module health reflects real test signal instead of an onboarding seed, and the dashboard flags every form of staleness/drift in one place — without any code path silently mutating `module-map.yml`.

## Current state (verified 2026-05-28 against main @ `1dc492f`)

- `module-map.yml` is write-once: only [src/document/workflow.ts](src/document/workflow.ts) `generateModuleMapYaml` / `writeModuleMap` (Stage 1 of `documentation-update`) writes it.
- `docs/modules/<slug>/**` is read-only relative to the map; the only drift signal is the report-only [list-orphan-module-dirs.sh](runtime/base/skills/documentation-workflow/scripts/list-orphan-module-dirs.sh).
- `.paqad/module-health/<slug>.json` has five distinct writers ([src/onboarding/orchestrator.ts:224](src/onboarding/orchestrator.ts), [src/planning/module-health-updater.ts](src/planning/module-health-updater.ts), [src/cli/commands/module-health.ts](src/cli/commands/module-health.ts), [runtime/hooks/module-health-sync.sh](runtime/hooks/module-health-sync.sh), [src/pipeline/phases/verification.ts](src/pipeline/phases/verification.ts)) but none roll up coverage/test results; every record in this repo is the onboarding seed (`tier: unknown`, metrics null).
- Dashboard ([src/dashboard/collectors/module-health.ts](src/dashboard/collectors/module-health.ts)) penalises records older than 30 days but does not compare `updated_at` to `last commit touching sources`, and has no collector for map-vs-code drift or pending decisions.
- No reconciler exists; no code path detects undeclared modules in source.

The five bugs enumerated in issue §3 are all reproducible against current `main`.

## Scope decisions (captured from the planning dialogue)

1. **Single PR.** Branch `feat/issue-80-module-lifecycle`. Phase 1 → Phase 4 land together. Commit history structured one logical commit per phase + setup, so review can proceed phase-by-phase. Changesets bump: **minor** (additive feature, no breaking workflow changes for projects that opt into the new gates).
2. **Phase 1 includes the inferencer (§4.3.b)** alongside the extractor. No deferred 1.b.
3. **All packs in [runtime/capabilities/coding/stacks/](runtime/capabilities/coding/stacks) gain a `module_health` block** in the same PR. No half-supported state.
4. **Extractor and inferencer are TS-canonical, skill-wrapped.** Pattern set + apply logic live in `src/module-decisions/`; SKILL.md tells the agent when to invoke and how to surface results via Decision Pause Contract.
5. **Tighter defaults than the issue proposed:**
   - `proposed_ttl_days: 7` (issue suggested 14)
   - `git_window_days: 14` (issue suggested 30)
   - `source_roots` is **required**; no silent fallback to `module-map.yml`'s `sources:` paths. Reconciler refuses with `blocked: source_roots_unknown` when missing.
6. **Dashboard checks** (`status` / `dashboard` commands):
   - **Staleness flag** — module's `updated_at` < last commit touching its `sources:` paths.
   - **Pending / expired `MD-XXXX`** decisions surfaced as attention items.
   - **Drift badge** — count of `MM-*` findings from latest `.paqad/module-map/drift.json`, per module.
   - **`--fail-on-drift` flag** on `status` — exits non-zero when any of the four signals are present.
7. **`--fail-on-drift` trips on:** any `MM-*` finding · stale health (per above) · expired `MD-XXXX` · `MM-DOC-MISSING`.

## Constitution waiver

The pre-implementation spec rule in `docs/instructions/rules/_shared/constitution.md` was satisfied by this document. No constitution rule is suspended for this PR.

## Acceptance Criteria

### Phase 1 — prospective module decisions

1. New `MD-XXXX` schema and state machine in `src/module-decisions/schema.ts`, with states `draft | proposed | accepted | rejected | expired | superseded`. Only `accepted` mutates `module-map.yml`.
2. New TS engine in `src/module-decisions/extractor.ts` applies a finite pattern set (`module: <slug>`, `new module <name>`, `<name> module`, `in the <name> module`, ticket headers `Module:` / `Component:` / `Area:` / `Subsystem:`) and emits `MD-XXXX` drafts. Pattern set lives in code; extending it is a framework PR.
3. New TS engine in `src/module-decisions/inferencer.ts` runs only when the extractor returns nothing; forms a hypothesis from existing `features:` + `sources:` and emits a multi-choice draft.
4. New atomic apply path in `src/module-decisions/apply.ts`: pre-mutation snapshot to `.paqad/module-map/history/<ts>-MD-<id>.yml` → temp-write + rename of `module-map.yml` → record update → `.paqad/module-map/events.jsonl` append. This is the **only** code path that writes `module-map.yml` going forward (Stage 1 of `documentation-update` re-routed through it).
5. New skills: `runtime/base/skills/module-attribution-extractor/`, `runtime/base/skills/module-attribution-inferencer/`. SKILL.md wraps the TS engines and surfaces drafts via Decision Pause Contract (`AskUserQuestion` under Claude Code).
6. New CLI: `paqad-ai module-decisions list | show <id> | expire-stale`.
7. `feature-development.yaml` `planning` stage spliced with the Attribution Gate: extractor → inferencer → atomic apply → continue.
8. `finding-normalizer` recognises `MD-*` vocabulary.
9. Slug collisions and near-collisions (Levenshtein ≤ 2) explicitly surfaced; multiple modules in one prompt → one `MD-XXXX` each.
10. Stale `proposed` decisions expire after `proposed_ttl_days` (default **7**, project-overridable via bounded schema).
11. No `MD-XXXX` transitions to `accepted` without an explicit user response captured by Decision Pause Contract.

### Phase 2 — retrospective reconciler

12. New skill `runtime/base/skills/module-map-reconciler/` and engine `src/module-map/reconciler.ts`.
13. Reconciler emits findings `MM-ADD | MM-FEAT-ADD | MM-REMOVE | MM-RENAME | MM-FEAT-STALE | MM-DOC-ORPHAN | MM-DOC-MISSING | MM-MISMATCH`; consumed by `finding-normalizer`.
14. User-approved deltas applied via Phase 1's `apply.ts` (same history + events path).
15. Intent triggers added at priority 225 in `runtime/base/skills/workflow-router/assets/routing-rules.txt`: `reconcile module map`, `refresh module map`, `update module map`, `check module map`, `module map drift`.
16. Auto-detection at three moments (detect-only):
    - End of `feature-development.documentation_sync` — stops with `stale_docs: stop` if undeclared modules touched by diff.
    - `paqad-ai refresh` — non-zero exit on drift.
    - `paqad-ai status` — surfaces drift count per module.
17. Reconciler reads `source_roots` from the active stack pack. **Hard-fails with `blocked: source_roots_unknown`** when missing — no silent fallback.
18. Rename detection (`MM-RENAME`) uses stack pack's `public_api_extractor`; if absent, falls back to `MM-REMOVE` + `MM-ADD`.
19. Reconciler emits no `MM-ADD` when slug was prospectively declared in Phase 1; emits `MM-MISMATCH` when prospective declaration and actual code paths diverge.

### Phase 3 — test-driven module health

20. Each pack under `runtime/capabilities/coding/stacks/<stack>/pack.yaml` gains a `module_health` block with: `test_command`, `coverage_format`, `coverage_path`, `test_report_format`, `test_report_path`, `source_roots`, `source_globs`, `public_api_extractor`.
21. Framework ships parsers for: `lcov`, `cobertura`, `coverage-py-xml`, `gocover`, `junit-xml`, `go-json`, `jacoco`, `opencover`, `vitest-json`. Each parser is a `src/module-health/parsers/<format>.ts` file.
22. New skill `runtime/base/skills/module-health-rollup/` and engine `src/module-health/rollup.ts`.
23. Rollup runner:
    - Reads stack pack's `module_health` block.
    - Either runs `test_command` or consumes `--from-report <path>`.
    - Parses via declared format.
    - Maps covered/tested files → module slugs via `module-map.yml`'s `sources:` globs.
    - Rolls up `coverage_pct`, `tests_passing`, `tests_failing`, `tests_total`.
    - Computes `change_velocity` from `git log -- <sources>` over the configured `git_window_days` (default **14**).
    - Computes `contract_stability` from `public_api_extractor`; blocked if absent.
    - Writes `.paqad/module-health/<slug>.json` in the new shape (issue §6.4) with `blocked_metrics` populated for whatever can't be computed. **No metric is fabricated or zeroed.**
24. `feature-development.checks` stage triggers rollup after `format/test/build`.
25. `paqad-ai module-health sync --from-report <path>` supported.
26. `runtime/hooks/module-health-sync.sh` repurposed to call rollup (not just timestamp).
27. `src/planning/module-health-updater.ts` record shape extended with `blocked_metrics` and `evidence` fields.
28. No project-side parsers loadable; extending the parser set is a framework PR.

### Phase 4 — dashboard checks + events surfacing (your explicit ask)

29. `status` flags any module whose `updated_at < last commit touching sources` (uses the same 14-day window for the git query).
30. `status` surfaces pending and expired `MD-XXXX` decisions as attention items.
31. New collector `src/dashboard/collectors/module-map-drift.ts` reads latest `.paqad/module-map/drift.json` and emits a drift badge per module.
32. New collector `src/dashboard/collectors/module-decisions.ts` surfaces pending/expired decisions.
33. New collector `src/dashboard/collectors/module-events.ts` summarises recent `.paqad/module-map/events.jsonl` entries.
34. New CLI `paqad-ai module-events list | since <date> | for-module <slug>`.
35. New `status --fail-on-drift` flag exits non-zero when **any** of: (a) any `MM-*` finding in latest drift.json, (b) stale health per AC #29, (c) expired `MD-XXXX`, (d) any `MM-DOC-MISSING`.
36. `.paqad/module-map/events.jsonl` records every reconciliation outcome, every rollup, every accepted decision.

### Cross-cutting

37. Changeset added: `minor`, summary `"Living module lifecycle: prospective decisions, retrospective reconciliation, test-driven health, dashboard drift checks (closes #80)"`.
38. All new code paths covered by Vitest units; integration tests cover the Attribution Gate end-to-end in `tests/e2e/` and the reconciler against a fixture project.
39. No regression in existing Vitest suite; `pnpm ci` green locally on macOS before push.
40. `docs/RELEASE-WORKFLOW.md` referenced — release proceeds via Changesets PR after merge, no manual publishing.
41. Issue #80 closed by the merged PR via `Closes #80`.

## Test Plan

- **Unit:** schema/state-machine of `MD-XXXX` (transitions, TTL expiry, slug normalisation, Levenshtein collision); extractor pattern set against a fixture corpus of pasted-ticket strings; inferencer hypothesis-former against a fixture map; atomic apply (snapshot → rewrite → record update → events append) including failure-mid-write recovery; each parser (lcov/cobertura/coverage-py-xml/gocover/junit-xml/go-json/jacoco/opencover/vitest-json) against canonical sample reports.
- **Integration:** Attribution Gate end-to-end with a stub `AskUserQuestion` driver; reconciler run against a fixture project with seeded drift in all `MM-*` categories; rollup runner against a fixture project producing real coverage XML/JSON.
- **Dashboard:** snapshot tests of `status` output for each of the four drift signals individually and combined; `status --fail-on-drift` exit-code matrix.
- **Manual local:** `pnpm ci` green; `paqad-ai status --fail-on-drift` exits 0 on clean state, non-zero with seeded drift; `paqad-ai module-decisions list` and `paqad-ai module-events list` smoke-tested.
- **CI:** all three required matrix legs (`Node 22 / ubuntu`, `Node 24 / ubuntu`, `Node 22 / macOS`) green.

## Out of scope

- Jira / Linear / GitHub Projects API integration (issue §11). User pastes the ticket; no auth, no API.
- LLM-flavored free-form module extraction. Extractor uses a finite, framework-owned pattern set.
- Per-project custom extractors, inferencers, reconcilers, parsers, or decision schemas.
- Replacing the user-validation contract at Stage 1 of `documentation-update`.
- Module-health for non-code artefacts (designs, docs, configs).
- Deprecating `list-orphan-module-dirs.sh` — promoted into `MM-DOC-ORPHAN` finding source, kept as the script for back-compat.
- Phase 1.b "deferred inferencer" path (this PR ships extractor + inferencer together).
- Windows CI leg (still tracked separately by #17 / S-17).

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Single PR is large enough that reviewers miss issues | One logical commit per phase + setup commit; PR description maps phases → commits. |
| `source_roots` hard-fail breaks onboarded projects on older packs | Same PR adds `module_health.source_roots` to every pack in `runtime/capabilities/coding/stacks/`; release notes call out the requirement. |
| Decision Pause Contract integration regresses other workflows | Attribution Gate gated by a new `feature-development.planning` step that no-ops when the prompt has no module references and the inferencer is confident. |
| Tighter 7d TTL surfaces stale-decision noise in slow-paced repos | TTL is project-overridable via bounded `module_decisions.proposed_ttl_days` config. |
| `--fail-on-drift` lands and immediately breaks consumers' CI | Flag is opt-in; default `paqad-ai status` continues to exit 0. Documented in release notes. |
