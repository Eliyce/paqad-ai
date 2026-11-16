---
id: "TD-01M7HJ2F1R6ABPYFW1HFRYF9Z3"
title: "Dashboard markdown preview renders marked output without sanitizing it"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "graph-ui/src/views/InstructionsView.tsx"
found_in:
  change: null
  issue: null
  stage: null
found_by: "orchestrator"
session: "7f9f31a9-4447-5b01-a192-8d0f55ad2feb"
created_at: "2026-11-16T06:52:48.491Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

graph-ui/src/views/InstructionsView.tsx line 276 turns markdown into HTML with marked.parse and line 452 puts it into the page with dangerouslySetInnerHTML. marked does not sanitize its output, so HTML in a doc runs in the dashboard. Breaks rule RL-7f59. Sanitize with DOMPurify first, and pass { async: false } instead of the as string cast.
