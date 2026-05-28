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

The set difference between source and contract is deterministic — drive it
with the scripts. Reserve LLM judgment for severity and the "is this primitive
correctly wrapped" question.

1. Run `scripts/derive-inventory.sh [components-dir]` → `<name>\t<source-file>` TSV. The script already excludes tests, stories, type decls, barrels, and lower-case helpers.
2. Run `scripts/parse-components-md.sh <components.md>` → `<name>\t<variants-csv>\t<states-csv>` TSV. Empty CSV slots are `-`.
3. Run `scripts/diff-inventories.sh --source <derived> --declared <parsed>`. Each row is a deterministic gap:
   - `in-source-not-declared\tName\t<file>` → `documentation-drift` finding, **medium**.
   - `declared-not-in-source\tName\t-` → `documentation-drift` finding (contract references a non-existent component), **medium** to **high** depending on whether the contract is what the team intends to build.
4. Run `runtime/scripts/design/scan-overrides.sh` to enumerate `!important`, inline `style=`, arbitrary Tailwind brackets, undocumented utility combos. The LLM decides whether each hit is a missing prop on a declared component or genuine code smell.
5. For each declared component, verify its declared variants are implemented in the source file. Missing variant → `component` finding, **high**.

## Output Contract

- Match `assets/output.template.md`. `contract_ref` is `components.md → <ComponentName>` or `patterns.md → override budget`.
- Default severity `high` for missing-variant findings, `medium` for override sprawl, `low` for cosmetic deviations.
- Output must pass `scripts/lint-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when `components.md` has no entries — defer to `design-system-coverage` (tier likely `bare`).
- Warn when the inventory exceeds 100 components — the audit may need to be chunked.

## Resources

- `references/component-conformance-checklist.md`
- `scripts/derive-inventory.sh` — AST-ish inventory of `src/components/**`.
- `scripts/parse-components-md.sh` — declared inventory + variants/states from `components.md`.
- `scripts/diff-inventories.sh` — set difference between source and declared.
- `scripts/lint-findings.sh`
- `assets/output.template.md`
- `agents/openai.yaml`
