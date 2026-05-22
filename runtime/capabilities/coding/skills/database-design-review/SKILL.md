---
name: database-design-review
description: Review schema and migration changes for integrity and safety.
model_tier: reasoning
triggers:
  - database_impact:
      - schema-change
      - data-migration
cacheable: true
cache_key_inputs:
  - database/migrations/**
  - docs/modules/*/database/schema.md
  - docs/modules/*/database/indexes.md
output_format: markdown
input_schema:
  schema_paths:
    type: path[]
    required: true
    description: Schema or migration artifacts to review.
  request_text:
    type: string
    required: false
    description: Optional change summary.
---

## What It Does

Reviews schema and migration changes for correctness, rollout safety, and maintainability, with findings split cleanly across correctness risk, migration safety risk, and performance risk.

## Use This When

Use this for any request that changes tables, constraints, nullability, data movement, or migration sequencing, even when the code change seems small.

## Inputs

- Read the changed migrations and the closest database docs for the affected module first.
- Read `runtime/capabilities/coding/checklists/database-review-20pt.md` and `references/database-review-rubric.md` before reviewing.
- Read any query or index docs that justify the new schema shape.

## Procedure

1. Run `scripts/scan-migration-smells.sh <migration-files...>` to surface candidate hazards (destructive drops, NOT-NULL without default, renames without shim, type changes, table locks, data deletion).
2. Cross-reference each hit with `assets/safe-migration-rules.txt` to decide whether it's actually unsafe in this project's context.
3. Review schema design (cardinality, defaults, constraints, nullability) and index/FK coverage as judgment work.
4. Bucket findings into Correctness / Migration Safety / Performance per `assets/output.template.md`.
5. Validate with `scripts/lint-output.sh`.

## Output Contract

- Return sections named `Correctness Risks`, `Migration Safety Risks`, and `Performance Risks`.
- List each finding as one bullet with the exact schema element or migration involved.
- If a bucket has no findings, write `<Bucket Name>: none` exactly.

## Escalate / Stop Conditions

- Ask when data volume, deployment sequencing, or rollback expectations are required to judge safety.
- Warn when a migration appears non-additive, irreversible, or likely to lock hot tables.
- Do not wave through undocumented backfills or destructive column changes.

## Resources

- `references/database-review-rubric.md`
- `scripts/scan-migration-smells.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/safe-migration-rules.txt`
- `runtime/capabilities/coding/checklists/database-review-20pt.md`
- `agents/openai.yaml`
