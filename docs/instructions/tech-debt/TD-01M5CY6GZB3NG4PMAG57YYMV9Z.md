---
id: "TD-01M5CY6GZB3NG4PMAG57YYMV9Z"
title: "Allow once also replaces a deny from another tool's PreToolUse hook on the same edit"
kind: "gap"
severity: "medium"
status: "open"
files:
  - "docs/modules/feature-evidence/features/rule-override/technical.md"
  - "runtime/claude-plugin/mod/register.tsx"
found_in:
  change: "01M5CCWX6FTKY8C6EJKMR9EH3D"
  issue: null
  stage: null
found_by: "paqad-review"
session: "d789e5c2-ce91-442b-a379-7e12b94b7dd9"
created_at: "2026-10-20T15:17:08.709Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The HUD mod's Allow once replaces the engine's folded PreToolUse verdict. paqad's own gates and settings permission rules are now excluded (sole flag, pending packets, entry sentinel, verdict.rule), but a deny from another tool's or plugin's PreToolUse hook carries no marker the mod can read, so Allow once also replaces that deny. The limit is documented in docs/modules/feature-evidence/features/rule-override/technical.md ("Known gap") but nothing tracks closing it.

Possible fix: have the capability gate store a digest of its exact stderr in the stop record and only offer Allow once when the engine verdict reason matches that digest, or ask the host engine to expose per-hook deny sources on tool.check.
