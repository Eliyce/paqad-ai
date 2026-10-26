---
id: "TD-01M5VRHVTQ24C395EA30WZ41TD"
title: "SessionStart release trusts the hook's parent pid, which can be a short-lived shell or a reused pid"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/stage-evidence/completion-deferred.ts"
  - "src/stage-isolation/subagent-completion.ts"
found_in:
  change: "01M5TJYB18G4MFYZNWKKGCFJW9"
  issue: null
  stage: "checks"
found_by: "paqad-review"
session: "425309d6-34dc-40a5-8b76-819d7cb8a08b"
created_at: "2026-10-26T09:27:05.276Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

`recordStageAgentStart` (src/stage-isolation/subagent-completion.ts:162) stores `host_pid: process.ppid` on a started stage-agent row. `releaseStageAgentsAtSessionStart` (src/stage-evidence/completion-deferred.ts:160) keeps another session's started row only while that pid is alive.

## Limits kept

- The pid is the hook's parent. When the host runs the hook through a shell that does not exec the last command, the parent is a short-lived shell. That pid is already dead at the next SessionStart, so a second terminal releases the live agent, the same as before 01f8cb71.
- A dead pid that the OS reuses for another process reads as alive. The row then holds until a stage_end, a newer agent or stage_start, or its own session resumes.
- No clock is used (D-01M5VMTDH7P9Y17CFH9NA2EMC1), so there is no age-based release.

## Fix idea

Record the host's own pid when the hook payload or env supplies it (or walk up from ppid past a shell to the host process), and store the process start time next to the pid so a reused pid is not taken as the same host. Related: TD-01M5VMXRMKTVPN1735B09YYQPZ (in-session kill).
