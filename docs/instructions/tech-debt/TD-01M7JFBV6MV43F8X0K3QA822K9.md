---
id: "TD-01M7JFBV6MV43F8X0K3QA822K9"
title: "one-chain-per-session hook test runs out of memory under the parallel unit suite"
kind: "bug"
severity: "low"
status: "open"
files:
  - "tests/unit/hooks/paqad-disabled.test.ts"
found_in:
  change: "01M7J8JE08Q0TPKF57BS49FRWZ"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "c3d97a78-504b-5d70-81e8-966dd5dfda15"
created_at: "2026-11-16T15:24:44.518Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The paqad-disabled.test.ts "one chain per session" block passes alone (41/41) but the developer saw it run out of memory when the full unit suite runs in parallel. It is not touched by the HUD change. Find what holds memory under parallel load or move it to its own shard.
