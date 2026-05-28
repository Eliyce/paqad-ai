---
name: module-map-reconciler
description: Retrospective reconciler that scans the source tree against module-map.yml and docs/modules/, emits MM-* findings into .paqad/module-map/drift.json, and surfaces user-approvable deltas. Issue #80, Phase 2. The TS engine lives in `src/module-map/reconciler.ts`; this skill is the agent-side wrapper that invokes it via the CLI and routes accepted deltas through `src/module-decisions/apply.ts` (the only writer of module-map.yml).
model_tier: medium
triggers:
  - workflow:
      - feature-development
      - documentation-update
      - module-map-reconcile
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  project_root:
    type: path
    required: false
    description: Project root used to resolve module-map.yml and source_roots. Defaults to cwd.
  source_roots:
    type: string[]
    required: false
    description: Override source_roots discovered from the active stack pack. Hard-fails when neither is provided.
---

## What It Does

Walks the source tree under `module_health.source_roots` (declared on the active stack pack), compares the files it finds against `module-map.yml`'s declared modules / features and the `docs/modules/<slug>/` tree, and emits findings:

| Code | Meaning |
| --- | --- |
| `MM-ADD` | Source files exist under a directory that no module's `sources:` glob matches. |
| `MM-FEAT-ADD` | Files under a known module match no declared feature glob. |
| `MM-REMOVE` | Declared module has no matching source files. |
| `MM-RENAME` | Module's symbol moved (only emitted when the stack pack ships a `public_api_extractor`; otherwise falls back to `MM-REMOVE` + `MM-ADD` per spec AC #18). |
| `MM-FEAT-STALE` | Declared feature has no matching source files. |
| `MM-DOC-ORPHAN` | `docs/modules/<slug>/` exists with no matching module declaration. |
| `MM-DOC-MISSING` | Declared module has no `docs/modules/<slug>/` directory. |
| `MM-MISMATCH` | A prospective `MD-XXXX` declaration and the actual code paths diverge. |

Findings are written to `.paqad/module-map/drift.json` and consumed by:

- `paqad-ai status` (drift badge per module — Phase 4).
- `paqad-ai refresh` (non-zero exit on drift).
- `feature-development.documentation_sync` (stop with `stale_docs: stop` if undeclared modules were touched by the diff).
- `finding-normalizer` (via the `MM-*` code-prefix recognised in `assets/vocabulary.txt`).

## Use This When

- A user prompt matches the priority-225 router rules (`reconcile module map`, `refresh module map`, `update module map`, `check module map`, `module map drift`).
- `feature-development.documentation_sync` is about to close and you need to confirm no undeclared modules were touched.
- `paqad-ai refresh` invokes it to fail fast on drift.

## Inputs

- The active stack pack's `module_health.source_roots`. **Required** — refuses to run with `blocked: source_roots_unknown` when missing. Bundled details in `runtime/base/skills/module-map-reconciler/references/source-roots-contract.md`.
- `module-map.yml` (read-only here; mutations go through `src/module-decisions/apply.ts`).
- `docs/modules/<slug>/` tree for orphan / missing checks.
- Existing `.paqad/decisions/module-decisions/*.yml` for `MM-MISMATCH` cross-referencing.

## Procedure

1. Resolve `source_roots` from the active stack pack. If absent, surface a single Decision Pause packet asking the user to add `module_health.source_roots` to their pack — do **not** guess.
2. Invoke the TS engine via CLI:
   ```
   paqad-ai module-map reconcile --project-root <root>
   ```
   This produces `.paqad/module-map/drift.json` and prints a JSON summary.
3. Parse findings. Group by code and module for presentation.
4. For each finding, surface a Decision Pause packet:
   - `MM-ADD` → "New module under `<dir>`. Declare? (extract → inferencer → apply)" — pipes through the Attribution Gate.
   - `MM-FEAT-ADD` → "Add feature glob to `<module>`?" — collects feature name + glob, then routes to apply.
   - `MM-REMOVE` / `MM-FEAT-STALE` → "Remove declaration?" or "Update glob?".
   - `MM-DOC-ORPHAN` → "Delete `docs/modules/<slug>/` or declare module?"
   - `MM-DOC-MISSING` → "Run `create module documentation` for `<slug>`?".
   - `MM-MISMATCH` → "Apply pending `MD-XXXX` or revise?".
5. Apply accepted deltas through `src/module-decisions/apply.ts`. Never write `module-map.yml` directly.

## Output Contract

- `.paqad/module-map/drift.json` written with the full report (findings + counts + `blocked`).
- A `## Reconciliation Findings` markdown block listing each code, count, and one-line detail.
- A `## Pending User Decisions` block listing each surfaced packet's question and selected option.
- When invoked from `documentation_sync` and any `MM-ADD` / `MM-MISMATCH` finding touches the diff, exit with `stale_docs: stop`.

## Escalate / Stop Conditions

- Hard-fail with the literal status `blocked: source_roots_unknown` when the active stack pack has no `module_health.source_roots`. Print the path to the pack manifest that needs updating; do **not** prompt to "use a default."
- Stop if `module-map.yml` is missing — the reconciler needs declarations to reconcile against. Surface `Reconciler requires module-map.yml; run "create documentation" first.`
- Stop if any `MM-RENAME` is ambiguous (multiple candidates within Levenshtein bound) — collect the user's choice.
- Do **not** write `module-map.yml` from this skill. All map mutations go through `src/module-decisions/apply.ts`.

## Resources

- `runtime/base/skills/module-map-reconciler/references/source-roots-contract.md` — the source_roots requirement.
- `runtime/base/skills/module-map-reconciler/agents/openai.yaml` — agent interface metadata.
- `src/module-map/reconciler.ts` — detection engine.
- `src/module-decisions/apply.ts` — atomic apply path (only writer of `module-map.yml`).
- `runtime/base/skills/documentation-workflow/scripts/list-orphan-module-dirs.sh` — back-compat orphan detector promoted into `MM-DOC-ORPHAN`.
- `.paqad/decision-pause-contract.md` — packet semantics.
