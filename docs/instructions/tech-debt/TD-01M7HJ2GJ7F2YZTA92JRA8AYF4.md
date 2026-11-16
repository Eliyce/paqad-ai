---
id: "TD-01M7HJ2GJ7F2YZTA92JRA8AYF4"
title: "Ctrl+C at an interactive prompt prints a stack trace"
kind: "bug"
severity: "low"
status: "open"
files:
  - "src/cli/index.ts"
found_in:
  change: null
  issue: null
  stage: null
found_by: "orchestrator"
session: "7f9f31a9-4447-5b01-a192-8d0f55ad2feb"
created_at: "2026-11-16T06:52:50.049Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

Nothing in src handles @inquirer/prompts ExitPromptError, so pressing Ctrl+C at any prompt ends in an unhandled rejection with a stack trace. Catch it by error.name once around program.parseAsync() in src/cli/index.ts and exit cleanly.
