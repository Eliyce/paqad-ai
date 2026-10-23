---
id: "TD-01M5JNJGFMSQP1XH0N3D5X9TJ3"
title: "Pre-mutation rule gate crashes with EISDIR when git status lists paths outside the project root"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/pipeline/change-evidence.ts"
  - "src/rule-scripts/runner.ts"
found_in:
  change: "01M5JN71AWEY8H27VTZ1ZBS1EY"
  issue: null
  stage: "planning"
found_by: "planning"
session: "36466929-a6e4-456b-8ffe-d045c79ed49e"
created_at: "2026-10-22T20:41:50.825Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

In a project that is not its own git repository, git walks up into the parent directory. `git status` then lists paths outside the project root, for example `../.aws/cli/cache`, which is a directory. `readGitStatusFiles` in src/pipeline/change-evidence.ts passes those paths on, and `hashFiles` in src/rule-scripts/runner.ts reads each one with readFileSync, which throws EISDIR. The pre-mutation rule gate fails closed, so every edit is blocked.

Seen while building the plugin eval fixture: an eval workspace under a temp HOME with no `.git`. Workaround in the eval fixture: the scaffold runs `git init` and makes one commit.

Fix direction: drop status paths that resolve outside the project root, and skip directories before hashing.
