---
id: "TD-01M6QV0TXRVFR8HN12GW88KXEX"
title: "Moving a change to a new branch strands its evidence record"
kind: "gap"
severity: "medium"
status: "open"
files:
  - "src/feature-evidence/adoption.ts"
found_in:
  change: null
  issue: null
  stage: null
found_by: "orchestrator"
session: "197e3479-5c84-5513-af65-369e07a804d6"
created_at: "2026-11-06T07:08:57.080Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

A change's evidence bundle records the branch it started on. When the work moves to a new branch mid-change (for example to follow the team's branch naming after the pre-push check refused the old name), the bundle is treated as belonging to another branch: the session drops it as active, and the next stage command mints a new untitled change on the new branch. `paqad-ai resume --feature <ref>` reports success but the reconcile step drops it again on the next command because the branch no longer matches.

Seen on the design sign-off change: the checks report landed in a stray `change-<ULID>` bundle instead of the change's own bundle.

Expected: a way to move a change to a new branch (for example `paqad-ai feature branch <ref>` or adopting the bundle when its recorded branch no longer exists and HEAD carries the same commits), so evidence stays in one bundle.
