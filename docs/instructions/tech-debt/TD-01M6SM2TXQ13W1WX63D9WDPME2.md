---
id: "TD-01M6SM2TXQ13W1WX63D9WDPME2"
title: "An empty change fast-forwarded to main is judged on main's files"
kind: "bug"
severity: "low"
status: "open"
files:
  - "src/feature-evidence/delivery.ts"
  - "src/pipeline/change-evidence.ts"
found_in:
  change: "01M6SCTKHRJ3BVTHQY2T3XR3KV"
  issue: "831"
  stage: "review"
found_by: "paqad-review"
session: "950169d2-6a83-4705-9685-3a9e2bc76ca4"
created_at: "2026-11-06T23:46:11.479Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

A change with no edits whose branch was fast-forwarded to a newer main reads main's files as its own. Measured: open a change on a branch, commit other.ts on main, `git merge --ff-only main`: `activeChangeFiles` returns [other.ts], the classifier reads `owner-feature-dev`, and implementation-review fails on a finding in other.ts. A real merge commit reads [] and a rebase of real edits keeps only the change's own file, both measured. `latestMergedBase` has no merge commit to find here.

This is the symptom the turn-end part of the issue describes, on a narrower path. It is not new: `changedFilesSince` alone returns the same file, so the fix that added committed files did not cause it.

## Why it is low

It fails safe: a change is held, never let through. The path needs a pull with no local commits while a change is open.

## Fix path

In `readChangeStartPoint`, when the start commit is an ancestor of the fork branch's tip and no commit since belongs to the change, move the start to that tip. Add the case to tests/unit/pipeline/active-change-files.test.ts.
