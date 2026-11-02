---
id: "TD-01M6CNDMGJ8MXW9KKC9Y2466CR"
title: "Authoring gate names the Claude stage-agent template as an agent called claude"
kind: "bug"
severity: "low"
status: "open"
files:
  - "runtime/templates/stage-agents/claude.md.hbs"
  - "src/authoring/paths.ts"
found_in:
  change: "01M6C9EFA7XZX6DXB3QPRXS7RH"
  issue: "796"
  stage: "review"
found_by: "paqad-review"
session: "f8332752-20fc-5e2a-a0e4-9b2570786496"
created_at: "2026-11-01T22:59:26.302Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

`agentStem` in src/authoring/paths.ts:164-166 strips `.hbs` and then the extension. So `runtime/templates/stage-agents/claude.md.hbs` resolves to an agent named `claude`, and `codex.toml.hbs` resolves to one named `codex`. The authoring completion gate lists that name among changed agents, which reads as an unknown agent. The file is the Claude stage-agent template, and `classifyAgentPath` already classes it as `template`. The lint and audit render it per stage (`claude.md.hbs#paqad-checks`), but `agentNameOf` and `findAgentPaths` do not.

## Fix

Have the completion gate (and `agentNameOf` callers) report a template path as the template, or as its rendered stage agents, not as an agent named after the file stem.
