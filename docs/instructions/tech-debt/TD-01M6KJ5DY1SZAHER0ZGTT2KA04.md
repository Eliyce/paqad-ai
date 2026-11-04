---
id: "TD-01M6KJ5DY1SZAHER0ZGTT2KA04"
title: "delivery-link install says the hooks are ready when it left a tracked or husky folder alone"
kind: "bug"
severity: "low"
status: "open"
files:
  - "src/cli/commands/delivery-link.ts"
found_in:
  change: "01M6K92PZ1DDTQ0Y221RS8QRK3"
  issue: "845"
  stage: "review"
found_by: "paqad-review"
session: "67df04a3-0df1-4746-b345-79c93986dc2e"
created_at: "2026-11-04T15:17:12.741Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

`paqad-ai delivery-link install` prints `git linkage hooks ready (up to date)` when `installGitHooks` installed nothing because the hooks folder is tracked or husky runs it. It never reads `trackedHooksDir` or the snippet, so the post-commit and post-merge lines are not in place while the output says they are ready.

## Why it is not fixed here

The tracked folder case predates this change, and this command is not part of the hook advice work. Update and doctor give the correct advice for the workflow hooks.

## Fix

When `trackedHooksDir` is true, print the snippet instead of the ready line.
