---
id: "TD-01M5VMXRMKTVPN1735B09YYQPZ"
title: "A stage agent killed mid-session without SubagentStop holds the turn-end judgement until the next stage row or session"
kind: "gap"
severity: "medium"
status: "open"
files:
  - "src/stage-evidence/completion-deferred.ts"
found_in:
  change: "01M5TJYB18G4MFYZNWKKGCFJW9"
  issue: null
  stage: null
found_by: "orchestrator"
session: "425309d6-34dc-40a5-8b76-819d7cb8a08b"
created_at: "2026-10-26T08:23:40.934Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

A paqad stage agent that is killed inside a live session without a SubagentStop keeps the turn-end judgement deferred. The deferral is released by that stage's stage_end, a newer stage agent or stage_start, or a new host session (SessionStart). There is no clock (NFR-6), and an empty Stop `background_tasks` list is not treated as a release (FR-1), because in a real run that list was empty while the planning agent was running.

Until one of those releases happens, the change is not judged, receipted or shown red. The owner chose this trade-off in D-01M5VMTDH7P9Y17CFH9NA2EMC1.

Possible follow-up: a host signal that reliably reports a dead background agent, or an explicit orchestrator release verb.
