---
name: design-system-coverage
description: Grade the project's design-system contract for completeness and produce a coverage inventory every downstream design-test skill references. Analog of stride-threat-model.
model_tier: reasoning
triggers:
  - workflow:
      - design-test
      - design-retest
cacheable: false
cache_key_inputs:
  - docs/instructions/design-system/**
output_format: json
input_schema:
  contract_paths:
    type: path[]
    required: true
    description: Files under docs/instructions/design-system/* that make up the project's design-system contract.
---

## What It Does

Grades `docs/instructions/design-system/` for completeness, produces a coverage inventory, and emits the **tier** (`missing | bare | adequate | strong`) the rest of the workflow uses to decide whether to stop, warn, or proceed in strict mode. Runs as Step 0 (readiness gate) and as the first skill in Step 1 — every downstream skill consumes this inventory.

## Use This When

Use this as the **first skill in every design-test run**. The tier it emits gates the entire workflow. Never skip it; never run other design-test skills without it.

## Inputs

- Read every file under `docs/instructions/design-system/` (typically `tokens.md`, `components.md`, `accessibility.md`, `motion.md`, `patterns.md`, `responsive.md`).
- Read `references/contract-clauses.md` before grading.

## Procedure

1. Run `scripts/list-contract-files.sh` to enumerate which contract files exist and which are empty/stub.
2. For each file, count the contract clauses (token entries, declared component variants, declared a11y rules, declared breakpoints, declared motion budgets, declared patterns).
3. Compute the tier:
   - **missing** — directory absent, or all six contract files empty.
   - **bare** — tokens partial; no component inventory; no a11y matrix.
   - **adequate** — tokens + components + a11y + at least one of `{patterns, motion, responsive}` populated.
   - **strong** — all six contract files populated.
4. Emit the coverage inventory per `assets/output.template.json` to `.paqad/design-test/runs/<run_id>/artifacts/contract-summary.json`.
5. Validate with `scripts/validate-contract.sh` — enforces required fields, allowed tier vocabulary, and rejects empty clause arrays when the tier is `adequate` or `strong`.
6. If tier is `missing`, raise a Decision Pause Contract packet asking the user whether to invoke the `documentation-update` workflow inline for `design-system` before resuming.

## Output Contract

- Match `assets/output.template.json`: `{ tier, files: [{ path, present, empty, clause_count }], clauses: { tokens: [...], components: [...], accessibility: [...], responsive: [...], motion: [...], patterns: [...] } }`.
- `tier` ∈ `missing | bare | adequate | strong`.
- Output must pass `scripts/validate-contract.sh` (exit 0).

## Escalate / Stop Conditions

- Stop and prompt when tier is `missing`. Offer inline invocation of the `documentation-update` workflow for the design-system.
- Warn when tier is `bare`. Run downstream skills in exploratory mode and tag findings `confidence: low`.
- Do not auto-engage `design_test.strict` when tier is `strong` — strict mode is explicit opt-in only.

## Resources

- `references/contract-clauses.md`
- `scripts/list-contract-files.sh`
- `scripts/validate-contract.sh`
- `assets/output.template.json`
- `agents/openai.yaml`
