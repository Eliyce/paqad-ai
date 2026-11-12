---
id: "TD-01M78CKCYKZZW0RXAF6152NXX8"
title: "Planning recipe fix makes the stage order check fail"
kind: "bug"
severity: "medium"
status: "open"
files: []
found_in:
  change: "01M77Y10DBA2ZPCGAA0GTC0QF4"
  issue: "890"
  stage: null
found_by: "orchestrator"
session: "08836cd6-d63d-4462-b84b-03f79333848d"
created_at: "2026-11-12T17:24:02.095Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

When the planning stage agent is dispatched before the change exists, no `recipe-injected` row is written for planning. The bundle-completeness gate then names its fix: dispatch the paqad-planning agent again, which runs `paqad-ai plan compile` and `paqad-ai stage end planning`.

Following that fix late in a change appends a new planning start and end after the later stages, so the stage-evidence gate reports the stages as out of order (planning after specification, development, checks and documentation_sync). The two gates disagree: the remedy one gate prescribes fails the other.

What would fix it: either record the planning recipe row when the change is created by a dispatched planning agent, or let a planning re-record that leaves plan.json unchanged count as a proof row without counting as a new planning run in the order check. Until then, create the change before the first planning dispatch.

Where: the planning recipe injection on SubagentStart, the bundle-completeness recipe check, and the stage-evidence order check.
