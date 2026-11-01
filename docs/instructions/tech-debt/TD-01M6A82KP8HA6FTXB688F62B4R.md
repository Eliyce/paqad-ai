---
id: "TD-01M6A82KP8HA6FTXB688F62B4R"
title: "git pull silently overwrites teammates' ignored per-machine .claude/settings.json once the shared file is committed"
kind: "gap"
severity: "medium"
status: "open"
files:
  - "src/adapters/claude/team-settings.ts"
  - "src/cli/commands/join.ts"
found_in:
  change: "01M6A05TM3ZSC30NH40VPAWT1F"
  issue: "802"
  stage: "review"
found_by: "paqad-review"
session: "96920aa3-794e-4503-86df-108493dc3af3"
created_at: "2026-11-01T00:27:44.691Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

Before #802 each machine's `.claude/settings.json` was git-ignored (listed in the committed `.claude/.gitignore`). Once the lead commits the shared `.claude/settings.json` and the new `.claude/.gitignore`, a teammate's `git pull` reaches a tracked file at a path where they hold an ignored file. Git treats ignored files as expendable and overwrites them without a warning, so any personal entries in that file (permissions, env, statusLine, their own hooks) are lost on pull. The lead's machine is migrated by `paqad-ai update` (entries move to `.claude/settings.local.json`, AC-20), but nothing covers teammates who already had paqad set up.

Suggested follow-up: say it in the README/upgrade note ("before you pull, move personal entries to `.claude/settings.local.json`"), or have the npm `silent-update` / `paqad-ai join` move personal entries of an ignored, untracked `settings.json` to `settings.local.json` ahead of the pull.
