---
id: "TD-01M5ZK3KZMCE6DE4X34PFAW698"
title: "Turn end clears the rule-gate pending marker even when it blocks, so under the Stop loop guard a budget-deferred edit can go unchecked"
kind: "gap"
severity: "medium"
status: "open"
files:
  - "runtime/hooks/capability-gate.mjs"
  - "src/kernel/capability.ts"
found_in:
  change: "01M5YZPHCJ89TVAMWFJYS19CJ0"
  issue: "756"
  stage: "documentation_sync"
found_by: "paqad-review"
session: "924099c9-ba6b-48aa-8fc2-867026e90f4d"
created_at: "2026-10-27T21:08:53.349Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

When the pre-edit rule gate runs out of budget it lets the edit through and writes a
pending-pre-mutation marker, so the turn-end (completion) seam runs the rule scripts even when
`classifyCompletionEnforcement` would skip the session. The completion seam clears the marker after
it runs (src/kernel/capability.ts, `clearPendingPreMutation` before the result is checked), whether
or not the run found a blocking violation.

The capability-gate hook does not block a second time when `stop_hook_active` is true
(runtime/hooks/capability-gate.mjs:148). So if the budget-deferred edit happened in a turn that was
already continued by a Stop-hook block, the turn-end run only prints the violation, returns 0, and
removes the marker. If the session is one the completion seam would otherwise skip (detour route,
not owner), nothing checks that edit again.

## Expected

Keep the marker while the turn-end run reports a blocking violation and clear it only after a clean
or no-op run, so the next turn end re-checks it. The loop guard then stops a block loop within one
turn, and the edit is still checked at the next turn end. Add a test: marker plus failing script,
turn end blocks, marker still present; fix the file, turn end passes, marker gone.
