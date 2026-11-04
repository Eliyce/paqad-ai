---
id: "TD-01M6KK0MVMVSXGA9Q59CZ7G2E0"
title: "Doctor says to delete an old delivery file that sits beside hand-written settings and may hold unmoved rules"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/git-workflow/migrate.ts"
  - "src/health/git-workflow-check.ts"
found_in:
  change: "01M6K92PZ1DDTQ0Y221RS8QRK3"
  issue: "845"
  stage: "review"
found_by: "paqad-review"
session: "67df04a3-0df1-4746-b345-79c93986dc2e"
created_at: "2026-11-04T15:32:04.569Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

When an old `docs/instructions/workflows/delivery-policy.yaml` sits beside git-workflow files that hold real settings, `gitWorkflowFilesAbsent` is false, so no move is pending. Update never moves the old file, and doctor says `is no longer read. Delete it.` That file may still hold rules that never moved. A bad stamp is not needed: a good stamp gives the same doctor line, and a bad stamp only adds its own line after it.

## How a project gets there

- Someone hand-writes settings beside an unmoved policy file.
- A released paqad ran `git-workflow change` or `setup` before its first update. The spec's non-goals exclude protecting against or repairing those projects.
- A branch merge brings the old file back beside files that already moved.

This build can't create the state itself: `git-workflow change`, `setup` and the dashboard refuse while a move is pending, and update and onboarding move first.

## Fix

Say to compare the old file with the new files before deleting it, or list the old values that differ from the new files.
