---
id: "TD-01M6QPY987X6D9221RPNY4M2FA"
title: "deliver commit rejects --summary because the parent deliver command swallows it"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/cli/commands/delivery.ts"
found_in:
  change: "01M6QK5T2B678P4DRW3T7FPYQB"
  issue: "787"
  stage: "review"
found_by: "paqad-review"
session: "197e3479-5c84-5513-af65-369e07a804d6"
created_at: "2026-11-06T05:57:39.143Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`paqad-ai deliver commit --summary "<text>"` fails with a missing required option error. The parent `deliver` command in src/cli/commands/delivery.ts declares its own `--summary <summary>` option, and the program does not call `enablePositionalOptions()`, so commander assigns the flag to the parent and the `commit` subcommand never sees its required `--summary`. Present on origin/main. Fix: enable positional options on the parent (and pass-through where needed), or drop the clash, and add a CLI test that runs `deliver commit --summary` end to end.
