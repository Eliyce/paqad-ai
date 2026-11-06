---
id: "TD-01M6QPY9Y11K3NQ3Z2KF8ZS6M0"
title: "agent-entry-gate abandoned-close fault test fails when run as root"
kind: "bug"
severity: "low"
status: "open"
files:
  - "tests/unit/runtime/agent-entry-gate.test.ts"
found_in:
  change: "01M6QK5T2B678P4DRW3T7FPYQB"
  issue: "787"
  stage: "review"
found_by: "paqad-review"
session: "197e3479-5c84-5513-af65-369e07a804d6"
created_at: "2026-11-06T05:57:39.837Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

tests/unit/runtime/agent-entry-gate.test.ts "a fault in the abandoned close keeps exit 0 and empty stdout, and is logged" makes the stage ledger read-only with chmod 0o444 to force a write fault. Under uid 0 (CI containers, cloud sandboxes) the chmod does not stop writes, the fault never happens, nothing is logged and the test fails with ENOENT on .paqad/logs/hooks.log. Fails identically on origin/main. Fix: inject the fault another way (for example make the ledger path a directory) or skip when process.getuid() is 0.
