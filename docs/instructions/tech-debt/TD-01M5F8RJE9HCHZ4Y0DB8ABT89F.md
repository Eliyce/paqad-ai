---
id: "TD-01M5F8RJE9HCHZ4Y0DB8ABT89F"
title: "HUD snapshot write takes ~150 ms after the Desktop HUD git reads"
kind: "debt"
severity: "medium"
status: "open"
files:
  - "src/hud/changed-files.ts"
  - "src/hud/snapshot.ts"
found_in:
  change: "01M5F1N4EYPBFM8GZAF61R347F"
  issue: null
  stage: null
found_by: "paqad-development"
session: "409965d3-e316-43be-bc2b-9581a5ec4c9a"
created_at: "2026-10-21T13:00:14.655Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`buildHudSnapshot` now reads git to fill `ship.files_changed`, `plan.done`, the acceptance claims
and the commit times of the Record. On this repo one snapshot build went from about 11 ms to about
150 ms. `stage-writer` refreshes the snapshot before every Edit and Write, so each edit pays it.

| Read | Time |
| --- | --- |
| `readGitState` (5 git processes) | 43 ms |
| `git diff --name-only <merge-base>` | 16 ms |
| `git ls-files --others --exclude-standard` | 50 ms |
| `git log <merge-base>..HEAD` | ~10 ms |
| `loadDeliveryPolicy` | ~8 ms |
| `buildChangeTraceabilityMap` | ~5 ms |

Measured with five builds in a row on the change worktree; the first build is slower (cold).

## Options

1. Add a merge-base helper to `src/rag/git-state.ts` that runs only the base check and
   `git merge-base` (2 processes instead of 5), and use it from `src/hud/changed-files.ts`.
   Saves about 25 ms.
2. Skip the git reads until the spec is frozen or Build has started, since nothing draws
   `files_changed`, `plan.done` or the acceptance claims before that.
3. Accept the cost. The untracked-file walk (about 50 ms) is inherent to listing untracked files;
   `git status --porcelain` costs the same.
