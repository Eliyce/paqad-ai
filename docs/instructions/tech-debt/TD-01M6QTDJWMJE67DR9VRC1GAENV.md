---
id: "TD-01M6QTDJWMJE67DR9VRC1GAENV"
title: "GitHub check-status tests depend on the machine's gh CLI"
kind: "bug"
severity: "low"
status: "open"
files:
  - "tests/unit/providers/github-host-provider.test.ts"
  - "tests/unit/providers/providers.test.ts"
found_in:
  change: "01M6QS1B1TGWVRSX9DZTVWT4NH"
  issue: null
  stage: null
found_by: "orchestrator"
session: "197e3479-5c84-5513-af65-369e07a804d6"
created_at: "2026-11-06T06:58:26.250Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

Three GitHub check-status tests fail in the cloud container on an untouched copy of main as well as on the design sign-off branch:

- github-host-provider: reads checks output "[{}]" as unknown
- github-host-provider: reads checks output with lint SUCCESS and test PENDING as pending
- providers: reads check status from gh json even on non-zero exit (pending)

Each provider call returns state unknown with no checks. The likely cause is the container's preconfigured `gh` CLI (it routes through an agent proxy) answering before the test's fake does, so the tests depend on the machine's `gh`. Make the tests inject the `gh` runner instead of resolving the real binary.
