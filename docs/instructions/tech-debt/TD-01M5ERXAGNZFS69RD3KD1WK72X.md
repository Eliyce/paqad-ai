---
id: "TD-01M5ERXAGNZFS69RD3KD1WK72X"
title: "Pre-mutation hook cold run (~10s) hits its 10s timeout and blocks the next edit"
kind: "bug"
severity: "high"
status: "closed"
files:
  - "runtime/hooks/capability-gate.mjs"
found_in:
  change: "01M5EQRYSFA51HDMC4XW13AFNB"
  issue: null
  stage: "documentation_sync"
found_by: "orchestrator"
session: "c4df07ba-554d-4d5d-b7d9-38d92761953b"
created_at: "2026-10-21T08:23:13.157Z"
reopened_at: null
issue: null
closed_reason: "Duplicate of TD-01M5DFWBB40C2D5J1EBEFQ3TEC (same cold-run timeout)."
---

## What

The `capability-gate.mjs pre-mutation` PreToolUse hook takes about 10 seconds on a cold run in this repo (measured 9.8s to 10.6s), and its configured timeout is 10 seconds with `onFailure: block`. After any change to the tree the next Edit or Write is blocked with "timed out", and a warm second run takes about 1.2s. In practice every edit after a commit or a file write fails once. Either the cold path needs to get well under the timeout (cache what the whole-tree scan computes, scope it to the target file), or the timeout needs headroom.
