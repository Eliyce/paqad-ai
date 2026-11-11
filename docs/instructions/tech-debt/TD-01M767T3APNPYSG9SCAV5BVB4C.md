---
id: "TD-01M767T3APNPYSG9SCAV5BVB4C"
title: "Four tests depend on the host: cloud-session env and running as root"
kind: "bug"
severity: "low"
status: "open"
files:
  - "tests/unit/providers/github-host-provider.test.ts"
  - "tests/unit/runtime/agent-entry-gate.test.ts"
found_in:
  change: null
  issue: null
  stage: null
found_by: "orchestrator"
session: "392a0455-f02c-5717-836b-2f715b701f82"
created_at: "2026-11-11T21:21:49.823Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

Four tests pass in GitHub CI but fail in a Claude Code cloud container, so `paqad-ai checks run` there is red on every change:

- `tests/unit/providers/github-host-provider.test.ts` (2) and `tests/unit/providers/providers.test.ts` (1): `GithubHostProvider` reads `process.env` by default, and `isCloudSession` is true when `CLAUDE_CODE_REMOTE=true`, so `getChecksStatus` takes the REST path instead of the mocked `gh pr checks`. The tests should pass an explicit `env` to the provider.
- `tests/unit/runtime/agent-entry-gate.test.ts` "a fault in the abandoned close ... is logged": the fault is made with `chmod 0o444`, which root ignores, so in a root container the close succeeds and nothing is logged. The test should skip when running as root, or cause the fault another way.
