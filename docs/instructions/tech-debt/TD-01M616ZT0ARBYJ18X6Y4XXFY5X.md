---
id: "TD-01M616ZT0ARBYJ18X6Y4XXFY5X"
title: "Fix proof ignores a red run recorded after a green, and fix prove drops a cd in --command"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/fix-protocol/fix-proof-record.ts"
  - "src/fix-protocol/fix-prove.ts"
found_in:
  change: "01M5JM36RM43G0JX8GD2PA7YTW"
  issue: "749"
  stage: null
found_by: "orchestrator"
session: "19ea5549-a6a6-420f-9c38-b10d9858ab78"
created_at: "2026-10-28T12:15:34.394Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`countedRedRow` in `src/fix-protocol/fix-proof-record.ts` walks the rows in order and stops at the first green row. A red run recorded after any green row is never counted, so a fix whose failing-first proof is shown after a green was recorded can never reach `red-green`.

Seen on the ask-owner-once change. The checks stage recorded a green first. The red was then shown honestly against the pre-fix commit (69069c94, the new tests failed 4 of 24), but the record still reads green-only.

Two smaller gaps:
- `fix prove` runs `--command` without a shell, so `cd <dir> && ...` is silently run in the project root. The red run then "passed before the fix", which is wrong evidence.
- A red row has no way to name the commit it ran against. It always records the project HEAD.

Fix idea: pair a red and a green by `test_id`, not by row order, and let `fix prove red` take `--at <commit>`, running the proof in a throwaway worktree.
