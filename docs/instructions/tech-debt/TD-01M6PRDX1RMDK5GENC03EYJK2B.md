---
id: "TD-01M6PRDX1RMDK5GENC03EYJK2B"
title: "The mod test harness cannot set the plugin root, so AC-32 and AC-33 stop at the pure function"
kind: "gap"
severity: "low"
status: "open"
files:
  - "runtime/claude-plugin/mod/test/world.ts"
  - "tests/unit/plugin/mod/paqad-cli.test.ts"
found_in:
  change: "01M6PKFYRQGVAS21PYXKKVC711"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "5120b703-1867-4d43-a812-acf4ba213dbe"
created_at: "2026-11-05T21:04:25.114Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The mod test harness has no way to set `$.plugin.root`, so AC-32 (a root holding a space) and AC-33 (an unset root) are proved on `pluginProgramPath` alone, in tests/unit/plugin/mod/paqad-cli.test.ts. The wiring in `paqadProgram` and `recordOverride` is proved only through the program-file-absent case in register.test.ts. Add a way for the world to set the root and pick Allow once through it.
