---
id: "TD-01M6PFVTK0MFYHTBT9T6C8AZBZ"
title: "Measure the ledger append cost on Windows and recover a lock that fails to release"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/core/fs/file-lock.ts"
  - "src/feature-evidence/ledger-append.ts"
found_in:
  change: "01M6KZV16XPRVAM7PK1SAZ4Y94"
  issue: null
  stage: "checks"
found_by: "orchestrator"
session: "78090261-fbdb-48aa-addc-5608d7cff246"
created_at: "2026-11-05T18:34:44.152Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`release()` in `src/core/fs/file-lock.ts` swallows a failed `rmdirSync`. On Windows, antivirus could cause that failure. The ownerless `.lock` is then not reclaimed for 60 seconds, so each append in that time waits 200 ms and writes a `lock-timeout` gap row. Found by reading the code, not seen happening.

The `fsync` on every ledger row is also about 70% of an append, is required by name in the stage recipes spec, and has no test proving it. It protects only against power loss or an operating system crash. Its cost on a developer's Windows disk has not been measured.

Expected: a failed release is retried or reclaimed at once, and the owner decides whether each row needs its own `fsync` once the Windows cost is measured.
