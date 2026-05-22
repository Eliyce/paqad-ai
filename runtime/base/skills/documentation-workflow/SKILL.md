---
name: documentation-workflow
description: Run the post-onboarding documentation creation workflow using the canonical tracker and the current application manifests. Supports two stages — foundation (docs/instructions/** and module-map.yml) and module-docs (docs/modules/** from reviewed map).
model_tier: medium
triggers:
  - workflow:
      - documentation-update
      - module-documentation
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  project_profile_path:
    type: path
    required: true
    description: Canonical project profile.
  detection_report_path:
    type: path
    required: false
    description: Current detection report.
  doc_progress_path:
    type: path
    required: false
    description: Canonical doc tracker.
  mode:
    type: string
    required: false
    description: 'foundation (default) or module-docs'
---

## What It Does

Runs the two-stage post-onboarding documentation workflow.

**Stage 1 — Foundation (`create documentation`)**
Generates `docs/instructions/**` (stack, architecture, design-system, registries, benchmarks, tech-debt) and writes `docs/instructions/rules/module-map.yml`. Module docs are explicitly deferred until the user reviews the map.

**Stage 2 — Module documentation (`create module documentation`)**
Reads `docs/instructions/rules/module-map.yml` as the sole authority for module and feature names, then generates `docs/modules/**`. Refuses to run if the map is absent.

## Use This When

- **`documentation-update` workflow**: Run Stage 1. Use for post-onboarding, stack-validation, or drift-refresh runs where instruction docs need to be created or regenerated.
- **`module-documentation` workflow**: Run Stage 2. Use only after the user has reviewed `module-map.yml` and confirmed business-language names.

## Inputs

- Read `.paqad/project-profile.yaml`, `.paqad/detection-report.json`, and `.paqad/doc-progress.json` if they exist.
- For Stage 2: require `docs/instructions/rules/module-map.yml`. Refuse if absent.

## Procedure — Stage 1 (foundation)

1. Validate the effective stack and capabilities against current manifests.
2. Recover any interrupted tracker entries still marked in-progress.
3. Generate or update `docs/instructions/stack/**`, `docs/instructions/architecture/**`, `docs/instructions/design-system/**`, `docs/instructions/registries/**`, `docs/instructions/benchmarks/**`, and `docs/instructions/tech-debt/**`.
4. Discover business modules from the codebase using the precedence order defined in the spec (user-provided → locked map entries → codebase-native containers → deterministic inference → LLM fallback).
5. Write or update `docs/instructions/rules/module-map.yml`.
6. Record `.paqad/doc-progress.json` with `moduleDocStage: pending_map_review`.
7. **Do not create or regenerate `docs/modules/**`.\*\*
8. End with the required message:

```
Module map written to docs/instructions/rules/module-map.yml.
Review and verify the module and feature names first. After the map is correct, prompt me with: create module documentation.
```

If any modules have low confidence, call them out explicitly in the final message.

## Procedure — Stage 2 (module-docs)

1. Run `scripts/check-stage2-prereq.sh` — exits non-zero (with the canonical refusal message) if `docs/instructions/rules/module-map.yml` is missing.
2. Read the map as the sole authority. Do not run discovery as a substitute.
3. Generate or update `docs/modules/{slug}/index/summary.md`, `docs/modules/{slug}/features/{featureSlug}/business.md`, `docs/modules/{slug}/features/{featureSlug}/technical.md`, and existing module support docs (database, api, integration, ui, error-catalog).
4. Update registries using map slugs, not raw folder names.
5. Update `.paqad/doc-progress.json` with `moduleDocStage: complete`.
6. Run `scripts/list-orphan-module-dirs.sh` and report any orphans under `## Orphaned Directories`. Do not delete them.

## Output Contract

- Match `assets/output.template.md`: `## Workflow Status`, `## Completed Stages`, `## Blocked Stages` headings.
- Stage 1 output must end with the literal text in `assets/stage1-final-message.txt` (verbatim).
- Stage 2 output must include `## Orphaned Directories` when `scripts/list-orphan-module-dirs.sh` returned any.
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Stop Stage 2 immediately if `module-map.yml` is missing.
- Ask when manifests and the stored onboarding profile disagree on stack or capability context.
- Do not skip a stage silently because a partial doc already exists.
- Do not invent module names when the map is present — use the map.

## Resources

- `references/workflow-stages.md`
- `scripts/check-stage2-prereq.sh`
- `scripts/list-orphan-module-dirs.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/stage1-final-message.txt`
- `.paqad/doc-progress.json`
- `docs/instructions/rules/module-map.yml`
- `agents/openai.yaml`
