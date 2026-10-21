---
id: "TD-01M5ERXAVWBZ4D9RK3DMP4HY6X"
title: "Decision self-arm mints create-vs-reuse from injected CLAUDE.md/memory text and for files outside the repo"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/planning/decision-selfarm.ts"
found_in:
  change: "01M5EQRYSFA51HDMC4XW13AFNB"
  issue: null
  stage: "documentation_sync"
found_by: "orchestrator"
session: "c4df07ba-554d-4d5d-b7d9-38d92761953b"
created_at: "2026-10-21T08:23:13.521Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The decision self-arm (`src/planning/decision-selfarm.ts`) reads the last user text in the transcript to detect a create-vs-reuse fork. On Claude Code that text includes the injected CLAUDE.md and memory index, which mention "reuse" many times, so it mints a create-vs-reuse packet on ordinary writes, including a Write to a scratch file outside the project. Observed: a packet whose only option evidence was a plan template in the session scratchpad. It should read only the user's own words, and never arm for a target outside the project root.
