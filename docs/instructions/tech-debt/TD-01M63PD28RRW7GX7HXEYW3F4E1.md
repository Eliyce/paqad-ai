---
id: "TD-01M63PD28RRW7GX7HXEYW3F4E1"
title: "Fast-lane implementation-review asks for a review stage that never runs, and keeps stale machine findings"
kind: "follow-up"
severity: "medium"
status: "open"
files:
  - "src/hud/snapshot.ts"
  - "src/verification/gates/implementation-review.ts"
found_in:
  change: "01M63JEPQH7KX2RP6R0JTN5Y14"
  issue: null
  stage: null
found_by: "development"
session: "5067f880-9a84-46e8-9d93-614ae3afaabe"
created_at: "2026-10-29T11:23:26.343Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What happens

On the fast lane no review stage runs, yet the implementation-review gate asks a review to address the machine findings (rule findings, near-copies) recorded for the change. The gate cannot be satisfied on that lane, so the work verdict reads fail or inconclusive for a reason the person cannot act on inside the lane.

A second case lands in the same gate: a machine finding recorded against a file that a later edit changed. Nothing re-scans after a change finishes, so the stale finding stays on record and keeps asking for a review that would look at code that no longer exists.

## What this change did

The HUD headline no longer lets this gate pre-empt Done: on the fast lane the gate is not judged, so the headline stays green Done and the gate's reason goes to the neutral gap line. The gate itself and the verdict are unchanged.

## What is left

- Decide where fast-lane machine findings are shown and how they are cleared without a review stage (for example the checks stage, or a re-scan at completion).
- Re-scan, or mark stale, machine findings whose file changed after they were recorded, before the completion gate reads them.
- Both change a verification gate's enforcement, so they need their own spec and review.
