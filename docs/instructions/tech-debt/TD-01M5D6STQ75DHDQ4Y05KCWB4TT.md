---
id: "TD-01M5D6STQ75DHDQ4Y05KCWB4TT"
title: "The build rewrites the tracked plugin.json version and flips two hook file modes"
kind: "debt"
severity: "medium"
status: "open"
files:
  - ".claude-plugin/plugin.json"
  - "runtime/hooks/lib/cost-refresh.mjs"
  - "runtime/hooks/lib/hud-heartbeat.mjs"
found_in:
  change: "01M5D6M14E5D3YEMGHXWT4QJQQ"
  issue: null
  stage: "checks"
found_by: "orchestrator"
session: "d789e5c2-ce91-442b-a379-7e12b94b7dd9"
created_at: "2026-10-20T17:47:29.888Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

Every build rewrites the tracked `.claude-plugin/plugin.json` version (it is still 1.95.1 in git while the package is 1.101.0) and flips the exec bit on `runtime/hooks/lib/cost-refresh.mjs` and `runtime/hooks/lib/hud-heartbeat.mjs`. Each checkout is dirty after a build, which made `changeset status` fail in the release job and keeps showing up as unrelated diffs. The version should be synced when changesets bumps the package, and the build should not touch tracked files or modes.
