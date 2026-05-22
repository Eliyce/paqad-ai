---
name: rollback-safety-planner
description: For each story with hard reversibility or wide blast radius, draft an executable rollback procedure before the story leaves planning.
model_tier: reasoning
triggers:
  - process_depth:
      - graduated lane
      - full lane
  - workflow:
      - feature-development
      - migration
      - refactor
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  story_plan_path:
    type: path
    required: true
    description: Story plan emitted by the story-designer agent.
  spec_path:
    type: path
    required: false
    description: Active spec used to validate rollback affects only the documented scope.
  module_doc_paths:
    type: path[]
    required: false
    description: Canonical module docs that establish operational conventions and feature flags.
---

## What It Does

Reads the story plan and selects every story tagged `reversibility: hard` or `blast-radius: wide`. For each, drafts a concrete rollback procedure: trigger condition, time-to-rollback target, step list executable by the on-call without consulting the original implementer, forward-only recovery notes when applicable, and a drill plan.

The point is to prevent surprised rollback failures during incidents — an explicit procedure is required before any high-cost story can be marked ready.

## Use This When

Use this immediately after the story-designer emits its plan in the graduated and full lanes. Skip stories where reversibility is `easy` and blast-radius is `isolated`. Always run for migration workflows.

## Inputs

- Read the story plan at `story_plan_path` first; identify each story's risk annotation.
- Read the spec at `spec_path` when available so the rollback's scope can be validated against documented behavior.
- Read canonical module docs in `module_doc_paths` for feature flag names, deployment conventions, and existing rollback patterns.
- Read `references/rollback-procedure-template.md` before drafting any procedure so every required field is populated.

## Procedure

1. Run `scripts/select-stories.sh <story_plan_path> [workflow]` to get story ids needing a plan (filters on `reversibility: hard`, `blast-radius: wide`, or workflow=`migration`).
2. For each selected story, draft a procedure with every field in `assets/required-fields.txt` (Trigger, Time-to-rollback, Steps, Verification, Forward-only, Drill).
3. Feature-flag rollouts: list the flag name as step 1; confirm the flag exists in the project's flag registry, never invent one.
4. Data migrations: describe forward-only recovery explicitly and call out permanently-lost data.
5. Every step must be idempotent and verifiable — declare the post-step check inline.
6. Format per `assets/output.template.md`; validate with `scripts/lint-output.sh`.

## Output Contract

- Match `assets/output.template.md`: `## Rollback Plans`, per-story `### S-N — name` with the 6 required fields, and a `Coverage:` footer.
- When no stories require a rollback plan, output the literal `Rollback Plans: none required (all stories have easy reversibility and isolated blast radius).`
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when a story implies operational machinery (kill switch, blue/green deployment, traffic shift) that the project profile does not declare available.
- Warn when a step would require the original implementer's tacit knowledge — rewrite until the on-call can run it cold.
- Warn when "restore from backup" is proposed without a stated Recovery Point Objective and a verified backup retention window.
- Do not mark a procedure complete if any field in the template is left unfilled.

## Resources

- `references/rollback-procedure-template.md`
- `scripts/select-stories.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/required-fields.txt`
- `agents/openai.yaml`
