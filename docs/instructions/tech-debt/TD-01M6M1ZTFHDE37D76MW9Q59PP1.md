---
id: "TD-01M6M1ZTFHDE37D76MW9Q59PP1"
title: "End-of-turn check judges a change while expert seats are still running"
kind: "bug"
severity: "low"
status: "open"
files:
  - "docs/modules/cli-lifecycle/index/summary.md"
found_in:
  change: "01M6KZV16XPRVAM7PK1SAZ4Y94"
  issue: null
  stage: "specification"
found_by: "orchestrator"
session: "78090261-fbdb-48aa-addc-5608d7cff246"
created_at: "2026-11-04T19:53:46.199Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The end-of-turn check holds off while a stage helper runs, but it does not count High Table expert seats as running. On 4 November 2026 it reported Needs your attention on the stage recipes change while seats were still working, before any code existed. It named a duplication finding in a docs file the change never touched and said the checks ran on different files.

Expected: while seats dispatched for an open specification stage are running, the check defers the same way it does for a stage helper.
