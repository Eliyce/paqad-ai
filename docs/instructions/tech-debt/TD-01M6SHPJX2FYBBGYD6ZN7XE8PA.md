---
id: "TD-01M6SHPJX2FYBBGYD6ZN7XE8PA"
title: "A change opened on the default branch and then branched is still judged on other files"
kind: "gap"
severity: "medium"
status: "open"
files:
  - "src/feature-evidence/adoption.ts"
  - "src/pipeline/change-evidence.ts"
found_in:
  change: "01M6SCTKHRJ3BVTHQY2T3XR3KV"
  issue: "831"
  stage: "documentation_sync"
found_by: "paqad-review"
session: "950169d2-6a83-4705-9685-3a9e2bc76ca4"
created_at: "2026-11-06T23:04:32.895Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

A change opened on the default branch and then moved to a new branch loses its session binding: `reconcileSessionControl` clears `active` because the recorded branch differs, so `activeChangeFiles` returns null. Measured in a temp repo: `stage start planning` on `main`, `git checkout -b fix/late`, no edits. Result: own files null, implementation-review still fails on a finding in `a.ts`, classifier enforces. So the original "blocked on files it never touched" symptom stays on this flow. FR-12 chose null on purpose, so this is not a defect in the change. Follow-up: update the recorded branch when the first branch is cut from the base, or treat "recorded base branch, HEAD descends from it" as the same change.
