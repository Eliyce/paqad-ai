---
id: "TD-01M6PXQWGXQY5NYW28FBN6SHFR"
title: "A template with no ticket slot drops a number-first branch's ticket with no message"
kind: "gap"
severity: "medium"
status: "open"
files:
  - "src/cli/commands/delivery.ts"
  - "src/delivery/workflow-findings.ts"
found_in:
  change: "01M6PKFYRQGVAS21PYXKKVC711"
  issue: null
  stage: "checks"
found_by: "paqad-review"
session: "5120b703-1867-4d43-a812-acf4ba213dbe"
created_at: "2026-11-05T22:37:15.076Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

This repo's branch template is `{prefix}/{title_slug}`, with no ticket slot, while its commit template is `{type}({ticket}): {summary}` and many of its branches start with the issue number, such as `feat/12-add-login`. `ticketInBranch` now returns nothing on those branches, as it was meant to. `paqad-ai deliver commit` with no `--ticket` renders `fix: ...` and `pr-ticket-link` no longer asks the PR to link the issue. `branch-shape` stays quiet because the name fits the template, so nothing tells the person the ticket was not read.

Any team whose template has no slot and whose people still put numbers first gets the same result.

A related case: a template that names `{ticket}` twice now throws on a duplicate capture group. The throw is caught, so every branch type gives no ticket for that source, also with no message.

## Fix

Move this repo's template to `{prefix}/{ticket}-{title_slug}`, which is the owner's call. Then have `doctor` or `deliver commit` say when a template has no slot but a commit or PR template expects a ticket. Report a template with two ticket slots when the workflow config loads.
