---
name: diff-doc-sync
description: Identify only the canonical docs made stale by the current diff.
model_tier: fast
triggers:
  - workflow:
      - feature-development
      - bug-fix
      - refactor
      - migration
cacheable: true
cache_key_inputs:
  - .paqad/session/changed-files.json
  - docs/maintainers/canonical-contract-map.md
  - docs/modules/README.md
output_format: json
input_schema:
  changed_files:
    type: path[]
    required: true
    description: Changed source or doc files from the current diff.
  detector_script_path:
    type: path
    required: true
    description: Path to the canonical stale doc detector script.
---

## What It Does

Narrows documentation follow-up to only the canonical docs made stale by the current diff, avoiding full documentation refreshes when `differential_refresh` is enabled.

## Use This When

Use this after implementation or validation when you already know which files changed and only want the stale canonical documentation set.

## Inputs

- Read the changed file list from `changed_files`.
- Read `references/diff-sync-rules.md` for project-specific override rules before deciding whether a doc can be safely skipped.

## Procedure

1. Pipe the changed file list into `scripts/detect-stale-docs.sh` — it cross-references against existing canonical docs and emits candidate paths.
2. Drop any paths that `references/diff-sync-rules.md` declares safe to skip in this scenario.
3. Format as a JSON array exactly matching `assets/output.template.json` (sorted, duplicate-free).
4. Validate with `scripts/lint-output.sh` — it enforces JSON shape, sortedness, dedupe, and `.md` suffix.

## Output Contract

- Match `assets/output.template.json`: a JSON array of canonical doc paths. `[]` exactly when none are stale.
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when the changed file list is missing or incomplete.
- Warn when the stale doc detector is unavailable or returns non-canonical paths.
- Do not widen the result to a full documentation workflow unless the detector evidence requires it.

## Resources

- `references/diff-sync-rules.md`
- `scripts/detect-stale-docs.sh`
- `scripts/lint-output.sh`
- `assets/output.template.json`
- `agents/openai.yaml`
