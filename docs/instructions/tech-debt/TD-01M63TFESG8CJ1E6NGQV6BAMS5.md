---
id: "TD-01M63TFESG8CJ1E6NGQV6BAMS5"
title: "HUD rules-override call runs paqad-ai from PATH, not the plugin's own bin"
kind: "gap"
severity: "low"
status: "open"
files:
  - "runtime/claude-plugin/mod/register.tsx"
found_in:
  change: "01M63JEPQH7KX2RP6R0JTN5Y14"
  issue: null
  stage: "review"
found_by: "review"
session: "5067f880-9a84-46e8-9d93-614ae3afaabe"
created_at: "2026-10-29T12:34:39.007Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

`recordOverride` in `runtime/claude-plugin/mod/register.tsx:159` runs `$.process.run(['paqad-ai', 'rules', 'override', ...args])`. The bare program name `paqad-ai` is looked up on the person's PATH, so whatever `paqad-ai` comes first on PATH runs. That can be a different version, or a different program with the same name.

## Why it matters

The rule for HUD security says the mod runs only the plugin's own `paqad-ai` (`$.plugin.root` + `runtime/claude-plugin/bin/paqad-ai`) with fixed arguments. The new CI-refresh call uses the plugin path. This older call does not, and this change did not touch it.

## Fix

Route the override call through the same resolver as the CI refresh (`paqadProgram($)`), with no PATH fallback. On Windows, pick `paqad-ai.cmd`. Update the `mod-source.test.ts` pin at line 89.
