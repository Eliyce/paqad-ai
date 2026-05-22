---
name: performance-regression-estimator
description: Identify performance hazards in a proposed solution or change set before code is written, classified by severity and hot-path placement.
model_tier: reasoning
triggers:
  - process_depth:
      - graduated lane
      - full lane
  - workflow:
      - feature-development
      - refactor
      - migration
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  proposed_solution_path:
    type: path
    required: true
    description: Implementation outline that describes the data access, concurrency, caching, and I/O the change introduces.
  changed_file_paths:
    type: path[]
    required: false
    description: Source files in the current change set; used to scope hazards to actually-changing code.
  module_doc_paths:
    type: path[]
    required: false
    description: Canonical module docs that establish hot-path requirements (latency budgets, throughput targets).
---

## What It Does

Reads a proposed implementation outline and the changed files, scans for known performance hazards (N+1 queries, sync-in-async, missing pagination, suspicious caching, sequential network calls, hot-path logging), and classifies each by severity and hot-path placement.

The point is to catch latency and cost regressions during planning, not after a load test or a customer-facing slowdown.

## Use This When

Use this in the graduated and full lanes whenever the change touches data access, request handlers, scheduled jobs, or anything with a stated latency or throughput requirement. Skip when the change is purely structural (renames, moves) and exercises no new code paths.

## Inputs

- Read the proposed solution at `proposed_solution_path` first.
- Read the changed-file list to scope hazards to code that is actually changing.
- Read canonical module docs in `module_doc_paths` for declared latency budgets and throughput targets — a hazard on a hot path with a sub-100ms budget is much more severe than the same hazard on a daily batch job.
- Read `references/perf-hazards.md` before classifying any hazard so the catalog and severity rubric stay consistent.

## Procedure

1. Enumerate code paths the change introduces/modifies (handlers, jobs, consumers, libs); mark each as hot-path or not based on canonical module docs.
2. Run `scripts/scan-perf-smells.sh <changed-files...>` to surface candidate hazards (N+1, await-in-loop, async-map without Promise.all, deep-clone-via-JSON, log-in-hot-path, unbounded-pagination, cache-without-invalidation, sequential-fetch).
3. Classify each detected hazard using `assets/severity-rubric.txt` — `high` only when on a hot path; `medium` on cold path with unbounded volume; `low` otherwise.
4. For every `high` hazard, propose a concrete remediation tied to the same `file:line`.
5. Format per `assets/output.template.md`; validate with `scripts/lint-output.sh`.

## Output Contract

- Return a heading named `Performance Hazards`.
- Provide a `Hazard Map` table with columns `#`, `Hazard`, `Path`, `On hot path?`, `Severity`, `Remediation`.
- Provide a `Recommended Pre-Merge Actions` ordered list of the `high`-severity hazards' remediations.
- Provide an `Open Questions` section listing paths whose hot-path status could not be confirmed from the available docs.
- When no hazards are detected, return `Performance Hazards: none detected.` exactly.

See `assets/output.template.md` for the canonical shape; `scripts/lint-output.sh` enforces it.

## Escalate / Stop Conditions

- Ask when the module's hot-path classification cannot be derived from canonical docs and the proposed solution implies a tight latency budget.
- Warn when caching is being added without a documented invalidation rule — recommend either declaring the rule or removing the cache layer.
- Do not silence a `high` hazard with phrases like "we'll fix it later" — high hazards must either be remediated or explicitly deferred via a Decision Packet.

## Resources

- `references/perf-hazards.md`
- `scripts/scan-perf-smells.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/severity-rubric.txt`
- `agents/openai.yaml`
