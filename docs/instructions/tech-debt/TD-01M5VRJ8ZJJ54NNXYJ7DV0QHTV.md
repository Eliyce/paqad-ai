---
id: "TD-01M5VRJ8ZJJ54NNXYJ7DV0QHTV"
title: "A base merge on a branch with earlier work still counts the merged files as the change's edit"
kind: "bug"
severity: "medium"
status: "closed"
files:
  - "src/feature-evidence/delivery.ts"
found_in:
  change: "01M5TJYB18G4MFYZNWKKGCFJW9"
  issue: null
  stage: "checks"
found_by: "paqad-review"
session: "425309d6-34dc-40a5-8b76-819d7cb8a08b"
created_at: "2026-10-26T09:27:18.723Z"
reopened_at: null
issue: null
closed_reason: "Fixed: a committed path counts only if it differs from both the start commit and the later merge-base with the base branch."
---

## What

## What

`latestMergedBase` (src/feature-evidence/delivery.ts:318) moves the start point forward to merge-base(HEAD, base) only when that point descends from start_commit. When the branch carries earlier unmerged work (start_commit is not on the base branch) and the base is then merged in, the point does not descend from start_commit. The start commit is kept, and every file the merge brought in counts as this change's edit again.

Reproduced: branch with an earlier ORD-1 commit, change opens, commit mine.ts, main gains theirs.ts, merge main. `readChangeGit` with `readChangeStartPoint` returns [mine.ts, theirs.ts].

## Effect

Same as the review-2 major, limited to branches with earlier work (the commit-split case): rule-script enforcement, traceability, checks, spec freeze and the review digest see the base branch's files.

## Fix idea

When a later base merge exists, list a path only if it differs from start_commit AND from merge-base(HEAD, base) (the intersection of the two diffs). A path the merge brought in matches the base, so it drops out. A path only earlier work touched matches start_commit, so it drops out. Add a test for earlier work plus a base merge.
