---
id: "TD-01M6NEZWJ958ZJHS82QR8E3JMJ"
title: "The stage write check refuses ordinary read-only shell commands"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "runtime/hooks/stage-agent-write-guard.mjs"
  - "src/stage-isolation/bash-write-guard.ts"
found_in:
  change: "01M6KZV16XPRVAM7PK1SAZ4Y94"
  issue: null
  stage: "development"
found_by: "paqad-development"
session: "78090261-fbdb-48aa-addc-5608d7cff246"
created_at: "2026-11-05T09:00:14.252Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The check that stops a stage agent writing into a change's records refuses ordinary read-only shell commands, because it reads parts of a command as if they were write targets. This was there before this work and is not fixed here.

Commands it has refused:

- A search followed by a listing: `grep ...; git stash list`
- A command with `2>/dev/null` after a `cd`
- `sed -i ''`, where the empty quotes are read as the file being written
- A variable holding a folder: `T=.paqad/tmp && cat > $T/...`

What it costs: the agent stops, rewrites the command and tries again, or reports a refusal that was not real. Nothing is written where it should not be, so this wastes turns but does not break the protection.

What a fix needs: read a command the way a shell splits it, so only real write targets count, and keep refusing a real write into the records. Each command above should become a test.
