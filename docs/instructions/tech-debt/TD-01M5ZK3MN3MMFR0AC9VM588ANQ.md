---
id: "TD-01M5ZK3MN3MMFR0AC9VM588ANQ"
title: "The pre-edit rule-gate budget does not cover the synchronous tree scan and hashing, so rule_gate_pre_edit=all can still hit the host timeout on a large tree"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/kernel/capability.ts"
  - "src/rule-scripts/runner.ts"
found_in:
  change: "01M5YZPHCJ89TVAMWFJYS19CJ0"
  issue: "756"
  stage: "documentation_sync"
found_by: "paqad-review"
session: "924099c9-ba6b-48aa-8fc2-867026e90f4d"
created_at: "2026-10-27T21:08:54.036Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

The pre-edit rule-gate budget (`rule_gate_budget_ms`, at most 9000 ms) aborts only the spawned rule
scripts. The synchronous preparation in `prepareRun` (src/rule-scripts/runner.ts) runs before the
abort signal can fire: `scanWorkingTree` over the whole tree and `hashFiles`, which reads every
target file. Under `rule_gate_pre_edit=all`, or with any whole-tree script selected, that work grows
with the size of the repository. On a large tree it could still run past the host's 10 s hook
timeout, and the fail-closed host would refuse the edit. That is the refusal the budget exists to
prevent (AC-37 covers scripts that run past the budget, not slow preparation).

Under the default `blocking-only` mode only changed files are hashed and the tree is not scanned, so
the default path is not affected.

## Expected

Check the budget between preparation steps (or make the scan and hash async and abortable), and add
a test that slows preparation and asserts the edit takes the budget path, not a host timeout.
