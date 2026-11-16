---
id: "TD-01M7HJ2FHNXQ3P20G2C1PEQ4YJ"
title: "graph-ui is never type-checked or linted"
kind: "gap"
severity: "medium"
status: "open"
files:
  - "graph-ui/package.json"
found_in:
  change: null
  issue: null
  stage: null
found_by: "orchestrator"
session: "7f9f31a9-4447-5b01-a192-8d0f55ad2feb"
created_at: "2026-11-16T06:52:49.003Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

graph-ui's build is vite build, which only transpiles, and the root eslint config ignores graph-ui with no config of its own. Type errors and lint issues in the dashboard reach main unchecked. Add tsc --noEmit -p graph-ui and an ESLint pass to CI (new rules RL from rules discovery: vite-3, eslint-2).
