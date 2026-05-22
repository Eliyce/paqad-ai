---
name: diff-minimizer
description: Classify each proposed implementation step against the acceptance criteria so scaffolding and over-build are dropped before code is written.
model_tier: reasoning
triggers:
  - process_depth:
      - graduated lane
      - full lane
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  acceptance_criteria_path:
    type: path
    required: true
    description: Acceptance criteria artifact written by the requirement analyst or acceptance-criteria-gen skill.
  proposed_solution_path:
    type: path
    required: true
    description: Implementation outline or solution proposal whose steps will be classified.
  module_doc_paths:
    type: path[]
    required: false
    description: Canonical module docs that establish what abstractions and patterns already exist as project convention.
---

## What It Does

Evaluates a proposed implementation outline step-by-step against the acceptance criteria. Classifies each step as `ac-satisfying`, `necessary-setup`, `scaffolding`, or `over-build` and recommends which scaffolding and over-build steps to drop before any code is written.

The goal is to move scope-creep detection upstream from post-implementation review into the planning phase.

## Use This When

Use this between `acceptance-criteria-gen` and the Story Designer's solution write-up, in the graduated and full lanes. Skip in the fast lane — the overhead is not justified for low-complexity work.

## Inputs

- Read the acceptance criteria artifact first; identifiers must be `AC-{fr}.{n}` so each step's mapped AC is unambiguous.
- Read the proposed solution outline (steps, files to modify, abstractions introduced).
- Read canonical module docs at the module paths listed in `module_doc_paths`. Patterns declared there are project conventions and cannot be classified as `over-build`.
- Read `references/classification-guide.md` before assigning any classification so the rubric stays consistent.

## Procedure

1. Run `scripts/extract-ac-ids.sh <ac-file>` to load the canonical AC id set; cross-check every cited id against this set.
2. Parse the proposed solution into discrete steps (one new file, one function, or one significant edit each).
3. Classify each step using `assets/classifications.txt` (`ac-satisfying`, `necessary-setup`, `scaffolding`, `over-build`).
4. For `scaffolding` / `over-build` steps, propose a leaner alternative or deletion.
5. List ACs with no satisfying step under `### Open Questions` (or write the literal `Open Questions: none`).
6. Format per `assets/output.template.md`; validate with `scripts/lint-output.sh`.

## Output Contract

- Return a heading named `Diff Minimization`.
- Provide a `Step Map` table with columns `#`, `Step`, `Classification`, `Mapped AC`, `Action` where:
  - `#` is the 1-based step index from the proposed solution.
  - `Classification` is exactly one of `ac-satisfying`, `necessary-setup`, `scaffolding`, `over-build`.
  - `Mapped AC` is the AC id when the step is `ac-satisfying`, the dependent step number when `necessary-setup`, and `—` otherwise.
  - `Action` is `keep` for `ac-satisfying` and `necessary-setup`, or `drop — <one-line reason>` for `scaffolding` and `over-build`.
- Provide a `Recommended Drops` section listing dropped step numbers with a one-line reason each.
- Provide a `Necessary Setup (justified)` section listing setup steps and the dependent step numbers.
- End with `Open Questions` listing AC ids with no satisfying step, or `Open Questions: none` exactly.

See `assets/output.template.md` for the canonical shape; the lint script enforces it.

## Escalate / Stop Conditions

- Ask when a step's classification depends on a product decision (e.g., whether a validation rule is required or polish).
- Warn when removing a `scaffolding` step would silently remove error handling the spec implied but did not state — flag for the requirement analyst rather than auto-drop.
- Do not classify a step as `over-build` if the canonical module docs at any provided path declare that abstraction as project convention.
- Do not invent AC ids; cross-check every cited AC id against the acceptance criteria artifact and emit unknown ids under `Open Questions`.

## Resources

- `references/classification-guide.md`
- `scripts/extract-ac-ids.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/classifications.txt`
- `agents/openai.yaml`
