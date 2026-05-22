---
name: glossary-maintainer
description: Maintain shared business terminology in the glossary.
model_tier: fast
triggers:
  - output_type:
      - documentation
      - report
cacheable: true
cache_key_inputs:
  - .paqad/glossary.md
  - docs/**/*.md
output_format: markdown
input_schema:
  changed_terms:
    type: string[]
    required: true
    description: Terms introduced or modified by the change.
  glossary_path:
    type: path
    required: true
    description: Canonical glossary file.
---

## What It Does

Keeps shared business terminology aligned across generated and canonical docs so the same concept is not described with competing names or overlapping definitions.

## Use This When

Use this whenever documentation or reporting introduces new domain terms, product language, or renamed concepts that should become canonical across the repo.

## Inputs

- Read `.paqad/glossary.md` first if it exists.
- Read the changed docs or reports that introduce or revise terminology.
- Read `references/term-guidelines.md` before adding new glossary entries.

## Procedure

1. Identify canonical business terms versus one-off phrasing.
2. For each candidate term, run `scripts/find-term-uses.sh "<term>"` to gather AC ids / API endpoints / doc files / source files factually — never invent paths.
3. Add or update concise product-focused definitions (no implementation detail).
4. Format per `assets/output.template.md`. When no cross-references exist for a new term, write `Used in: pending — flag for first consumer` exactly.
5. Validate with `scripts/lint-output.sh`.

## Output Contract

- Match `assets/output.template.md`: `## Glossary Updates` (term, definition, Used in:, optional Deprecated alias:) and `## Terminology Drift`.
- When nothing changes, write the literal `Glossary Updates: none`.
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when two teams use the same term differently and product ownership is needed to resolve it.
- Warn when documentation relies on unstable jargon that should not become canonical.
- Do not add internal implementation names as glossary terms unless they are already user-facing.

## Resources

- `references/term-guidelines.md`
- `scripts/find-term-uses.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `.paqad/glossary.md`
- `agents/openai.yaml`
