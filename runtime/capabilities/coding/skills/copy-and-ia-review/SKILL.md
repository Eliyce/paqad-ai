---
name: copy-and-ia-review
description: Audit voice, tone, labeling, and information architecture against patterns.md.
model_tier: medium
triggers:
  - workflow:
      - design-test
      - design-retest
cacheable: false
cache_key_inputs:
  - src/**
  - docs/instructions/design-system/patterns.md
output_format: markdown
input_schema:
  source_roots:
    type: path[]
    required: true
    description: Roots to scan for user-facing copy.
  patterns_path:
    type: path
    required: true
    description: Path to patterns.md contract clause.
---

## What It Does

Audits user-facing copy and information architecture against `patterns.md`: voice/tone vocabulary, error message format, button label conventions (`Save` vs `Submit` vs `Done`), empty-state copy, navigation labels. Catches inconsistent capitalization, ad-hoc terminology, and IA drift (a label that means different things on different routes).

## Use This When

Use for every design-test run. Runs last in the skill sequence — its findings are usually lower severity than token/component/a11y, but they accumulate into a coherent UX signal.

## Inputs

- Read `docs/instructions/design-system/patterns.md` for declared voice/tone rules and IA vocabulary.
- Read `references/copy-checklist.md`.

## Procedure

1. Extract user-facing strings from source: JSX text nodes, `aria-label`, `placeholder`, `title`, i18n message catalogs.
2. For each string, check:
   - Capitalization style (sentence case vs title case) matches `patterns.md`.
   - Terminology matches the declared glossary (e.g. `User` vs `Member` — pick one).
   - Error messages match the declared format (e.g. "What happened. What to do.").
   - Button labels match declared action verbs.
3. IA check: navigation labels and route names form a consistent hierarchy (no two routes labeled "Dashboard"; no label that contradicts its destination).

## Output Contract

- Match `assets/output.template.md`. `contract_ref` is `patterns.md → voice` / `patterns.md → terminology` / `patterns.md → error-format`.
- Severity: terminology contradiction → **medium**, capitalization drift → **low**, IA contradiction → **medium**, missing aria-label on icon-only control → cross-link to `accessibility-review`.
- Output must pass `scripts/lint-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when `patterns.md` declares no copy/voice rules — defer; emit a `documentation-drift` finding suggesting the team add one.

## Resources

- `references/copy-checklist.md`
- `scripts/lint-findings.sh`
- `assets/output.template.md`
- `agents/openai.yaml`
