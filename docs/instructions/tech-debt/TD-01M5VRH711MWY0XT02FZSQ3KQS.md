---
id: "TD-01M5VRH711MWY0XT02FZSQ3KQS"
title: "Codex writes no started stage-agent row, so the ledger cannot defer there"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/stage-evidence/completion-deferred.ts"
found_in:
  change: "01M5TJYB18G4MFYZNWKKGCFJW9"
  issue: null
  stage: "checks"
found_by: "paqad-documentation_sync"
session: "425309d6-34dc-40a5-8b76-819d7cb8a08b"
created_at: "2026-10-26T09:26:43.951Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

Codex has no SubagentStart hook, so no `started` stage-agent row is written there. The ledger-based running-stage check (FR-1, FR-5) cannot see a running stage agent on Codex. Today this is safe only because Codex runs stage agents in the foreground, so the turn does not end while one runs. If Codex ever runs them in the background, a turn end mid-stage would be judged.

Possible follow-up: write the `started` row from `paqad-ai stage start` when the caller is a stage agent, so every host gets it.
