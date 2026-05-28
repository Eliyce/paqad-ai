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

Extraction and rule-checking are deterministic — drive them with the scripts.
The LLM picks severity and writes findings.

1. Run `scripts/extract-user-strings.sh [search-root]` → `<category>\t<file>:<line>\t<string>` rows. Categories: `aria-label | placeholder | title | jsx-text`. This is the inventory of every user-facing string.
2. Run `scripts/check-action-verbs.sh --verbs <a,b,c> --root <dir>` to flag button labels outside the declared action-verb set. The match is case-insensitive; the offending label is reported as-typed.
3. Run `scripts/check-terminology.sh --preferred <Word> --avoid <a,b,c> --root <dir>` once per glossary entry. Each match is a `copy` finding citing the preferred term.
4. IA check: navigation labels and route names form a consistent hierarchy (no two routes labeled "Dashboard"; no label that contradicts its destination). No scripted detector — the LLM compares the route inventory from `runtime/scripts/design/enumerate-surface.sh` against the strings extractor's output.

## Output Contract

- Match `assets/output.template.md`. `contract_ref` is `patterns.md → voice` / `patterns.md → terminology` / `patterns.md → error-format`.
- Severity: terminology contradiction → **medium**, capitalization drift → **low**, IA contradiction → **medium**, missing aria-label on icon-only control → cross-link to `accessibility-review`.
- Output must pass `scripts/lint-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when `patterns.md` declares no copy/voice rules — defer; emit a `documentation-drift` finding suggesting the team add one.

## Resources

- `references/copy-checklist.md`
- `scripts/extract-user-strings.sh` — user-facing strings (`aria-label`, `placeholder`, `title`, JSX text).
- `scripts/check-action-verbs.sh` — button labels outside the declared verb set.
- `scripts/check-terminology.sh` — usages of disallowed terms given a `preferred -> avoid` map.
- `scripts/lint-findings.sh`
- `assets/output.template.md`
- `agents/openai.yaml`
