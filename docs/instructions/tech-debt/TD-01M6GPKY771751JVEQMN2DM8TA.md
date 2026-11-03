---
id: "TD-01M6GPKY771751JVEQMN2DM8TA"
title: "deliver commit subcommand always fails: parent deliver command owns required --summary/--ticket"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/cli/commands/delivery.ts"
found_in:
  change: "01M6GKEB1CZ8YW9W66PBCP0C3N"
  issue: "830"
  stage: "documentation_sync"
found_by: "paqad-review"
session: "b1c3f96d-5650-4ce0-87b3-8525f5b7de65"
created_at: "2026-11-03T12:37:19.185Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`paqad-ai deliver commit` always fails with "error: required option '--summary <text>' not specified". The parent `deliver` command declares `.requiredOption('--summary <text>')` and `--ticket` (src/cli/commands/delivery.ts:712-713), so commander demands them before the `commit` subcommand runs, even though `commit` declares its own `--summary`/`--ticket` (src/cli/commands/delivery.ts:778-779). Fix: move the required options off the parent onto the subcommands that need them, or make the parent option optional and validate in its own action. Found during the #830 review; not touched by #830.
