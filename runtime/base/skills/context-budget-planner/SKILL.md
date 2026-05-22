---
name: context-budget-planner
description: Estimate the implementation phase's token footprint from spec, test plan, and affected files; recommend compaction before context starvation.
model_tier: fast
triggers:
  - process_depth:
      - graduated lane
      - full lane
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  spec_path:
    type: path
    required: true
    description: Active spec artifact whose acceptance criteria drive the implementation.
  test_plan_path:
    type: path
    required: false
    description: Test plan artifact when available.
  affected_module_doc_paths:
    type: path[]
    required: false
    description: Canonical module docs the implementation will read.
  changed_file_paths:
    type: path[]
    required: false
    description: Files known to be in the change set so far.
---

## What It Does

Predicts the token footprint of the upcoming implementation phase before it starts. Reads spec size, test plan size, affected module docs, and known changed files; sums their token cost using the per-line weights in the heuristics reference; compares against the available budget; and recommends compaction when the estimate would push the session into the Amber or Red tier.

The point is to catch starvation before it happens, not after compaction has already evicted decisions mid-task.

## Use This When

Use this once at the boundary between planning and implementation in the graduated and full lanes — after acceptance criteria and test plan exist, before the first source file is opened. Skip in the fast lane; the overhead is not justified for low-complexity work.

## Inputs

- Read the active spec at `spec_path` first.
- Read `test_plan_path` when supplied.
- Read each module doc in `affected_module_doc_paths` only enough to compute its line count.
- Read `references/budget-heuristics.md` before applying any threshold so the per-line weights and tier boundaries stay consistent across runs.

## Procedure

1. Determine the project's model context window (from project profile) and committed tokens (default 200000 / 30000 if not declared).
2. Pick per-line weights from `references/budget-heuristics.md` (or `assets/weights.default.txt` if the project has none yet).
3. Pipe `<weight> <path>` rows into `scripts/estimate-tokens.sh --available <N> --committed <N>` — it line-counts, multiplies, sums, picks the tier, and emits the markdown block.
4. When the script reports Amber or Red, fill the compaction list using the priority order from `references/budget-heuristics.md`.
5. Validate the final output with `scripts/lint-output.sh`.

## Output Contract

- Match `assets/output.template.md`: `## Context Budget`, single `Summary:` line, `### Per-Artifact Estimate` table, `### Recommended Compactions`.
- Green/Yellow → `Recommended Compactions: none` exactly. Amber/Red → ordered list with one-line reasons.
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when the project profile declares no model context window and the default would clearly overcommit.
- Warn when `Tier: red` is reached even after applying every available compaction — implementation should be split into smaller stories rather than starting with no headroom.
- Do not recommend evicting the active spec, the rules constitution, the project profile, or the active decision packet under any tier.

## Resources

- `references/budget-heuristics.md`
- `scripts/estimate-tokens.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/weights.default.txt`
- `agents/openai.yaml`
