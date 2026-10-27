---
id: "TD-01M5ZM757VEE01R4HPT1N7G4TM"
title: "The pre-edit rule gate judges the edit target before the edit, so strict mode refuses an edit that removes a violation already in that file"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/kernel/capability.ts"
  - "src/rule-scripts/enforce.ts"
found_in:
  change: "01M5YZPHCJ89TVAMWFJYS19CJ0"
  issue: "756"
  stage: "checks"
found_by: "paqad-review"
session: "924099c9-ba6b-48aa-8fc2-867026e90f4d"
created_at: "2026-10-27T21:28:17.899Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What happens

Under `rule_gate_pre_edit=blocking-only`, the pre-edit rule gate now runs the deterministic changed-files scripts on the changed files plus the file being edited (owner decision D-01M5ZKGKVF0D5QC34E48R6QWBW). The scripts read the file as it is on disk before the edit lands. They never see the proposed content.

## Effect

In `rule_compliance=strict`, an Edit, Write, MultiEdit or NotebookEdit that would remove a violation already in a file that is not yet changed is refused, because the file still holds the violation. The same was already true for files in the change set, and on main for every file when the change set was empty (whole-tree fallback). The new part is a file touched for the first time in the middle of a change. The way out is `paqad-ai rules override` with the one-time token from the stop, or a fix the gate does not watch.

A target whose absolute path differs from the project root only by a symlink or by letter case (for example /var against /private/var on macOS, or a different drive-letter case that pathe does not fix) resolves to a `../` path and is dropped without a log line. The gate then checks only the changed files, as it did before the fix. Turn end still catches it.

## Possible fix

Pass the proposed content (new_string, content, edits[]) to per-file scripts and judge the after-state, or allow an edit that strictly reduces the target's findings. Realpath both the root and the target before relativising, and log a dropped target to hooks.log.
