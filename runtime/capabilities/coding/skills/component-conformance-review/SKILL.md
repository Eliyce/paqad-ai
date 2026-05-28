---
name: component-conformance-review
description: Verify every component in the AST-derived inventory matches its declared spec in components.md. Flag undocumented variants, !important, inline style=, and unwrapped primitives.
model_tier: reasoning
triggers:
  - workflow:
      - design-test
      - design-retest
cacheable: false
cache_key_inputs:
  - src/**
  - docs/instructions/design-system/components.md
output_format: markdown
input_schema:
  source_roots:
    type: path[]
    required: true
    description: Roots to scan for component definitions and usages.
  components_path:
    type: path
    required: true
    description: Path to the project's components.md contract clause.
---

## What It Does

Audits the project's UI components against `components.md`. The AST-derived component inventory is the subject; the contract is the standard. Every component used in source must appear in `components.md` with declared variants, states, and permitted compositions. Override sprawl (`!important`, inline `style=`, undocumented Tailwind combinations, shadcn primitives wrapped without spec) is a finding.

## Use This When

Use this for every design-test run, after `token-conformance-review`. The two together form the "is the contract followed at the source level" pair.

## Inputs

- Read `docs/instructions/design-system/components.md`.
- Read the contract-summary from `design-system-coverage` (declared component clauses).
- Read `references/component-conformance-checklist.md` before scanning.

## Procedure

1. Run `scripts/scan-overrides.sh` (shipped under `runtime/scripts/design/`) to enumerate override hits — `!important`, inline `style=`, arbitrary Tailwind brackets, undocumented utility combos.
2. Derive the AST component inventory from `src/components/**` (filenames, default exports, props types).
3. For each component in the inventory:
   - Is it declared in `components.md`? If not → `documentation-drift` finding.
   - Are all its declared variants implemented? Missing variant → `component` finding.
   - Does it wrap a primitive (e.g. shadcn `Button`) without applying the spec? → `component` finding.
4. For each override hit, decide whether it represents a missing variant in `components.md` or genuine code smell.

## Output Contract

- Match `assets/output.template.md`. `contract_ref` is `components.md → <ComponentName>` or `patterns.md → override budget`.
- Default severity `high` for missing-variant findings, `medium` for override sprawl, `low` for cosmetic deviations.
- Output must pass `scripts/lint-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when `components.md` has no entries — defer to `design-system-coverage` (tier likely `bare`).
- Warn when the inventory exceeds 100 components — the audit may need to be chunked.

## Resources

- `references/component-conformance-checklist.md`
- `scripts/lint-findings.sh`
- `assets/output.template.md`
- `agents/openai.yaml`
