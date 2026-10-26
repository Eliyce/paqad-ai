---
id: "TD-01M5VRJ2E7XV7F5VZKB3FXKQRK"
title: "HUD binds a foreground Agent call to the first new agent id; parallel or same-message dispatches are not told apart"
kind: "gap"
severity: "low"
status: "open"
files:
  - "runtime/claude-plugin/mod/live.ts"
  - "runtime/claude-plugin/mod/register.tsx"
found_in:
  change: "01M5TJYB18G4MFYZNWKKGCFJW9"
  issue: null
  stage: "checks"
found_by: "paqad-review"
session: "425309d6-34dc-40a5-8b76-819d7cb8a08b"
created_at: "2026-10-26T09:27:12.025Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

`ForegroundAgents` (runtime/claude-plugin/mod/live.ts:24) binds a foreground Agent call to the first agent id it has not seen before, and only when exactly one foreground call is unbound. Permission asks wait only for a bound agent (runtime/claude-plugin/mod/register.tsx:1075).

## Limits kept

- Two foreground Agent calls started together (one message with two Agent calls) stay unbound, so neither agent's permission ask shows "Waiting for your permission". Before 04fba07f both did.
- A background agent dispatched in the same message as one foreground call, whose first event arrives after the foreground call started, can be bound in place of the foreground agent. Its asks then wait and the foreground agent's do not.
- An agent dispatched by another agent is never foreground. Claude Code does not give subagents the Agent tool today, so this is latent.

The HUD fails quiet here: the host still shows its own prompt, only the headline is missing or wrong.

## Fix idea

Bind on a signal that names the call: the agent id in the Agent call's result (`agentId:` in a background launch result, so it can be excluded), or a SubagentStart row that carries the parent tool_use_id. Related: TD-01M5SHTYS3TRMRNHHJT3YKVDJY.
