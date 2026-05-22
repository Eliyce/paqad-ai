---
name: index-optimization
description: Review and improve indexing strategy for changed data paths.
model_tier: reasoning
triggers:
  - database_impact:
      - schema-change
      - query-change
cacheable: true
cache_key_inputs:
  - database/migrations/**
  - docs/modules/*/database/indexes.md
  - docs/modules/*/database/queries.md
output_format: markdown
input_schema:
  query_paths:
    type: path[]
    required: true
    description: Queries or explain plans to analyze.
  schema_paths:
    type: path[]
    required: false
    description: Relevant schema docs or migrations.
---

## What It Does

Evaluates whether changed query paths have the right supporting indexes and explains tradeoffs without drifting into speculative indexing unrelated to the current request.

## Use This When

Use this when a request introduces new filters, sorts, joins, uniqueness rules, or query-heavy flows that depend on index coverage.

## Inputs

- Read the changed query paths, migrations, and existing index docs first.
- Read `runtime/capabilities/coding/checklists/database-review-20pt.md` and `references/index-review-guide.md` before evaluating changes.
- Read any query inventory or performance notes tied to the affected module.

## Procedure

1. Run `scripts/scan-query-shapes.sh <files...>` to surface query patterns implying index requirements.
2. Cross-reference each shape with `assets/index-rules.txt` to know which index shape actually serves it.
3. Audit existing index docs for redundancy and ordering against those shapes.
4. Bucket findings into Correctness / Migration Safety / Performance per `assets/output.template.md`.
5. Validate with `scripts/lint-output.sh`. Recommend only indexes that serve the changed behavior or a directly adjacent hot path — no speculative.

## Output Contract

- Return sections named `Correctness Risks`, `Migration Safety Risks`, and `Performance Risks`.
- For each item, name the query path or index and the reason it is risky or recommended.
- If no changes are needed, state `Performance Risks: none` and keep the other buckets explicit.

## Escalate / Stop Conditions

- Ask when workload shape, row volume, or hot-path expectations are missing and materially change the recommendation.
- Warn when an index recommendation would meaningfully increase write cost or migration risk.
- Do not suggest speculative indexes without a concrete changed access pattern.

## Resources

- `references/index-review-guide.md`
- `scripts/scan-query-shapes.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/index-rules.txt`
- `runtime/capabilities/coding/checklists/database-review-20pt.md`
- `agents/openai.yaml`
