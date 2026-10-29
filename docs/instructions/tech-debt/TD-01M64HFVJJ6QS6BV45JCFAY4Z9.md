---
id: "TD-01M64HFVJJ6QS6BV45JCFAY4Z9"
title: "ac-test-mapping counts stale AC ids from older specs in any changed test file as proof"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/traceability/change-map.ts"
found_in:
  change: "01M64CVW05BZRGV1SHXT8WN7J7"
  issue: "750"
  stage: null
found_by: "paqad-review"
session: "0bbd9c56-f2a9-4da8-94d7-a58d08d85b00"
created_at: "2026-10-29T19:16:49.344Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`buildChangeTraceabilityMap` (src/traceability/change-map.ts:53-63) treats a criterion as proven when any changed test file has a test title or `@obligation` tag naming the bare id (`AC-20`). AC ids are only unique within one spec. Older specs' titles in files this branch touched therefore "prove" this spec's criteria. On the graduated-inline lane change, `.paqad/traceability/map.json` marks AC-20 proven by tests/unit/cli/config.test.ts:63 ('AC-20: shows mutation_mode ...', from an older change), and AC-1..AC-13 and AC-16..AC-19 are proven the same way by unrelated old titles. The gate passes or fails depending on which files happened to change, not on whether this spec's criteria are tested.
Fix options: count only titles/tags added or changed in this branch's diff (git diff hunks), or require a spec-scoped tag (e.g. `@obligation 01M64CVW:AC-20` or the change ULID prefix), or scope the matching to the lines the branch added.
