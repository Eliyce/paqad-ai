---
id: "TD-01M620JJV8ZAXHJ5XVSRNXWZT3"
title: "The HUD's askedCalls set grows by every permission prompt and is never pruned"
kind: "debt"
severity: "low"
status: "open"
files:
  - "runtime/claude-plugin/mod/register.tsx"
found_in:
  change: "01M61XDEFF9BAS6V560PT6PMK4"
  issue: "765"
  stage: "review"
found_by: "paqad-review"
session: "c08524c9-ca32-4dff-8570-cedfa2eac427"
created_at: "2026-10-28T19:42:44.054Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

runtime/claude-plugin/mod/register.tsx keeps a module-level `askedCalls` Set. The read-only `tool.check` hook adds every `tool_use_id` whose verdict is `ask` (every permission prompt in the session, for every tool), but entries are only removed by `retryAllowedOnce` for an allowed-once retry. In a long session the set grows by one short string per permission prompt and is never pruned.

Found reviewing #765. Impact is small (bytes per prompt), but it is unbounded.

## Fix

Only record `ask` for calls the hook is about to retry (for example keep a Set of in-flight retry ids and add to `askedCalls` only when the id is in it), or prune entries in the `tool.call` hook's finally for every Edit/Write/NotebookEdit call.
