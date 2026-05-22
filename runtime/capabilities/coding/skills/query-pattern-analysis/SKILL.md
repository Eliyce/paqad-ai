---
name: query-pattern-analysis
description: Analyze query behavior for correctness and performance risk.
model_tier: reasoning
triggers:
  - database_impact:
      - query-change
      - schema-change
cacheable: true
cache_key_inputs:
  - docs/modules/*/database/queries.md
  - docs/modules/*/database/schema.md
output_format: markdown
input_schema:
  query_paths:
    type: path[]
    required: true
    description: Queries or logs to inspect.
  module_doc_paths:
    type: path[]
    required: false
    description: Related module docs.
---

## What It Does

Analyzes changed query behavior for correctness, safety, and runtime cost so new data access patterns are reviewed against realistic usage rather than tiny fixture assumptions.

## Use This When

Use this when a request changes filtering, pagination, aggregation, eager loading, write batching, or any query path that could regress with real data volume.

## Inputs

- Read the changed query code and the module query/schema docs first.
- Read `references/query-risk-guide.md` before classifying issues.
- Read any existing performance rules or query inventories relevant to the stack.

## Procedure

1. Run `scripts/scan-query-risks.sh <files...>` to surface candidate risks (orm-find-in-loop, await-in-map, select-\*, unbounded pagination, ORDER BY RANDOM, leading-wildcard LIKE, group-having).
2. For each hit, look up the remediation rule in `assets/risk-rules.txt`.
3. Confirm whether the changed query relies on schema/index assumptions; treat missing index as a Migration Safety risk, not Performance.
4. Bucket findings per `assets/output.template.md`.
5. Validate with `scripts/lint-output.sh`.

## Output Contract

- Return sections named `Correctness Risks`, `Migration Safety Risks`, and `Performance Risks`.
- Each finding must name the affected query path and the user or operational impact.
- If one bucket has no issues, write it explicitly as `none`.

## Escalate / Stop Conditions

- Ask when expected row counts, pagination strategy, or consistency rules are unknown and would change the analysis.
- Warn when a query relies on undefined ordering, broad scans, or hidden fan-out behavior.
- Do not treat micro-optimizations as findings if the changed behavior is not on a meaningful path.

## Resources

- `references/query-risk-guide.md`
- `scripts/scan-query-risks.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/risk-rules.txt`
- `runtime/capabilities/coding/stacks/laravel/rules/performance/guide.md`
- `agents/openai.yaml`
