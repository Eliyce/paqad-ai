---
id: "TD-01M6SM2SGVJDS3GMD4020TE3TD"
title: "A session that moves to another change in the turn is judged on that change, not the one it edited"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/pipeline/session-ownership.ts"
found_in:
  change: "01M6SCTKHRJ3BVTHQY2T3XR3KV"
  issue: "831"
  stage: "review"
found_by: "paqad-review"
session: "950169d2-6a83-4705-9685-3a9e2bc76ca4"
created_at: "2026-11-06T23:46:10.039Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

A session that edits its own change, then moves to another session's planning-only change in the same turn, is judged on the change it moved to. Measured with runRepositoryVerification: on its own branch `ok:false`; after the move, classifier `edited-this-turn` but `ok:true` with the summary "Safe to merge", because every gate reads the moved-to change and that change is empty. On the next prompt the result is "verification not applicable".

Related limit in `isEmptyChange` (src/pipeline/session-ownership.ts): `recordLiveStageEdit` writes no row while the stage is already open, so development opened in an earlier turn and a commit this turn leaves no row, and the classifier reads `empty-change` after the move. A row with `session_source: cache` reads the same. The verification result is the same either way, so the skip hides nothing the enforce path would have judged.

## Why it is low

Nothing ships unjudged: the edited change is judged again when the session returns to it, and at delivery. It can mislead only for that turn. The empty change is never held: `ok:true` that turn, skipped from the next prompt, so it cannot be judged forever.

## Fix path

Do not print "Safe to merge" for a turn with this session's rows on another change, or judge the change the session edited rather than the one checked out.
