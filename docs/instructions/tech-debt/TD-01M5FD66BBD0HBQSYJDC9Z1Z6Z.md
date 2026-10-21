---
id: "TD-01M5FD66BBD0HBQSYJDC9Z1Z6Z"
title: "Terminal HUD still reads Getting ready when it cannot read the session's record"
kind: "gap"
severity: "low"
status: "open"
files:
  - "runtime/claude-plugin/mod/commands.ts"
  - "runtime/claude-plugin/mod/register.tsx"
found_in:
  change: "01M5F1N4EYPBFM8GZAF61R347F"
  issue: null
  stage: null
found_by: "paqad-review"
session: "409965d3-e316-43be-bc2b-9581a5ec4c9a"
created_at: "2026-10-21T14:17:35.329Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

On the terminal, a session whose id cannot be read (or whose snapshot file does not parse while no
earlier snapshot was read) still draws the idle band words `Getting ready`, and `/paqad trust`
answers with the no-record line and the help, not the reason. The owner decision says paqad says
so plainly when it cannot read its record, but the terminal is kept as it is today by Part K, so
the change only draws `paqad cannot read this session's record` on Desktop.

## Where

- `runtime/claude-plugin/mod/register.tsx`: the terminal `AbovePrompt` branch passes only
  `unavailable` to `layoutBand`, never `unbound`.
- `runtime/claude-plugin/mod/commands.ts`: `runPaqadCommand` with no snapshot answers `NO_RECORD`
  without the reason.

## Options

1. Give the terminal band and `/paqad trust` the same cannot-read line and reason as Desktop.
2. Keep it as it is until the terminal design is revisited.
