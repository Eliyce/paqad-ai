---
name: error-catalog-maintainer
description: Maintains per-module error catalogs
model_tier: medium
triggers:
  - workflow:
      - feature-development
      - bug-fix
max_lines: 200
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  changed_files:
    type: path[]
    required: true
    description: Implementation files affecting errors.
  error_catalog_paths:
    type: path[]
    required: true
    description: Canonical error docs to update.
---

## What It Does

Maintains per-module error catalogs so new or changed failure paths are documented with recovery guidance, ownership signals, and registry consistency.

## Use This When

Use this when a change introduces new error codes, modifies user-facing messages, or changes the recovery path for existing failures.

## Inputs

- Read the module `error-catalog.md` and any API error docs first.
- Read the changed implementation and any available error-code extraction output.
- Read `references/error-entry-fields.md` before editing catalog entries.

## Procedure

1. Run `scripts/find-error-catalogs.sh` to locate canonical per-module error catalogs.
2. Run `scripts/extract-error-codes.sh <changed-files...>` to surface candidate codes the diff introduces or renames.
3. For each new / changed code, write or update its entry using `assets/entry.template.md` (code, trigger, user message, operator meaning, recovery, retry safety, ownership).
4. Check global registry / module prefix collisions explicitly.
5. Format report per `assets/output.template.md` and validate with `scripts/lint-output.sh`. Vague user messages or unknown recovery → `## Catalog Gaps`, never a completed entry.

## Output Contract

- Match `assets/output.template.md`: `## Updated Error Entries` and `## Catalog Gaps`.
- Every updated entry must name the error code, catalog path, and changed trigger, message, recovery, or ownership field.
- Output must pass `scripts/lint-output.sh` (exit 0).
- Unknown recovery guidance, owner, or retry safety belongs under `Catalog Gaps`, never as a guessed completed entry.

## Escalate / Stop Conditions

- Ask when the correct user-facing recovery guidance depends on product or support policy.
- Warn when an error path leaks internal details or has no documented operator response.
- Do not approve an entry that only says a generic failure occurred.

## Resources

- `references/error-entry-fields.md`
- `scripts/find-error-catalogs.sh`
- `scripts/extract-error-codes.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/entry.template.md`
- `runtime/templates/runner-scripts/extract-error-codes.sh.hbs`
- `agents/openai.yaml`
