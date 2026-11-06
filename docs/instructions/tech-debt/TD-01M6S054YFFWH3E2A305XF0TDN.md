---
id: "TD-01M6S054YFFWH3E2A305XF0TDN"
title: "An agent-opened question over 5 options or with an unknown category skips the earlier check"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/decisions/authoring.ts"
found_in:
  change: "01M6RF9KPAM4XSEYPVGBBWZP70"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "8227e3c6-8b8e-4b12-af7a-b6ea0a107fe9"
created_at: "2026-11-06T17:57:55.753Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

An agent-opened question with more than 5 options, or with a category outside the list, gets no earlier check. `paqad-ai decision create` with 6 options and `create.mjs` with a made-up category both opened a pending packet with no `earlier_check`, and `decision resolve` closed each at once. The CLI refuses an unknown category and `create.mjs` does not, so the two doors differ.

The spec allows this in FR-11. None of the 160 resolved packets in this repository has either shape, so it has not happened here yet. It needs an unusual packet, and an agent can already pass the check with `suggest --none --reason`, so the check forces a step and not a judgement.

To fix: make `create.mjs` refuse an unknown category as the CLI does, and decide whether a question over 5 options should list titles too.
