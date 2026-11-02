---
id: "TD-01M6ETCXT5X3HKXJA1V04Q7XVF"
title: "Automatic plugin rollback leaves a project-scope plugin loading"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/install/plugin-migration.ts"
found_in:
  change: "01M6ESQZ4ECD8Z6S2CW3NHF4M4"
  issue: null
  stage: "checks"
found_by: "orchestrator"
session: "fc63f8db-c4a3-4dda-ad9c-8bd7dc9b5140"
created_at: "2026-11-02T19:04:54.828Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The automatic rollback (`plugin-never-loaded`, `plugin-never-installed`) undoes only the user scope: it runs `claude plugin uninstall --scope user` and removes the user settings keys. When a machine already moved to the plugin opens a repo that turns the plugin on in its tracked `.claude/settings.json`, and the plugin's SessionStart keeps failing there, the npm tick counts those sessions and the rollback fires, but the project-scope plugin keeps loading. The record then reads `rolled-back` while the plugin still runs in that repo.

Doctor already shows the truth there (`plugin (turned on by this project)`), and the user-scope move is now skipped in such repos, so this needs a machine that moved before opening one. Options: write the per-developer opt-out to `.claude/settings.local.json` of the ticking project (a background write into a repo), or keep the rollback user-scope only and say in the log that the project still turns it on.
