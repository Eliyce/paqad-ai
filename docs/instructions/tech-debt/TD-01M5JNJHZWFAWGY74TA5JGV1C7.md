---
id: "TD-01M5JNJHZWFAWGY74TA5JGV1C7"
title: "Plugin session start writes an unquoted PATH into CLAUDE_ENV_FILE, breaking Bash when the plugin root has a space"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "runtime/hooks/plugin-session-start.mjs"
found_in:
  change: "01M5JN71AWEY8H27VTZ1ZBS1EY"
  issue: null
  stage: "planning"
found_by: "planning"
session: "36466929-a6e4-456b-8ffe-d045c79ed49e"
created_at: "2026-10-22T20:41:52.369Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`ensureBinOnPath` in runtime/hooks/plugin-session-start.mjs writes `PATH=<binDir>:...` into CLAUDE_ENV_FILE without quoting. When the plugin root path has a space (for example a checkout at `.../paqad-ai npm`), every Bash call in the session fails with `zsh:1: no such file or directory: npm/runtime/claude-plugin/bin:...`.

Seen while running the receipt eval suite locally from such a checkout. CI paths have no space, so CI is not affected.

Fix direction: quote the value written to the env file and add a test with a plugin root that contains a space.
