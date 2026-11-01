---
id: "TD-01M6BTEW4DADBG0C2VA6M9JGJF"
title: "Environment-dependent provider and agent-entry-gate tests fail under root/sandbox"
kind: "bug"
severity: "low"
status: "open"
files:
  - "tests/unit/providers/github-host-provider.test.ts"
  - "tests/unit/providers/providers.test.ts"
  - "tests/unit/runtime/agent-entry-gate.test.ts"
found_in:
  change: "01M6B5R44JDNFBPXYAESEE5SN5"
  issue: "795"
  stage: "checks"
found_by: "paqad-review"
session: "4af9b4d2-9c6e-5ad7-9964-e1f971c5186b"
created_at: "2026-11-01T15:08:15.246Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

In this sandbox (root, proxied gh) four tests fail on a tree that does not touch their code: tests/unit/providers/github-host-provider.test.ts (two `reads checks output` cases), tests/unit/providers/providers.test.ts (`reads check status from gh json even on non-zero exit (pending)`) both return 'unknown' instead of 'pending', and tests/unit/runtime/agent-entry-gate.test.ts (`a fault in the abandoned close`) assumes chmod 0444 blocks writes, which it does not for root. They make every checks run red for unrelated changes. Make them hermetic (stub gh fully; skip or use a non-root-safe fault injection).
