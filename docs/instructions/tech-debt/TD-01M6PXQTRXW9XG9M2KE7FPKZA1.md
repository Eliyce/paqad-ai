---
id: "TD-01M6PXQTRXW9XG9M2KE7FPKZA1"
title: "A slug starting with a number still reads as a GitHub ticket on the default template"
kind: "bug"
severity: "low"
status: "open"
files:
  - "src/delivery/workflow-findings.ts"
found_in:
  change: "01M6PKFYRQGVAS21PYXKKVC711"
  issue: null
  stage: "checks"
found_by: "paqad-review"
session: "5120b703-1867-4d43-a812-acf4ba213dbe"
created_at: "2026-11-05T22:37:13.314Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

On a `{prefix}/{ticket}-{title_slug}` template with `require_ticket: false`, a branch whose title starts with a number still reads as a ticket. `feature/2024-plan` gives ticket 2024. paqad renders that exact name itself for a change with no ticket and the title "2024 plan".

## Why it matters

`prFindings` then raises `pr-ticket-link`, a blocking code, for an issue nobody meant. It is the same false block the owner hit with `round-5`, narrowed to a number at the start of the slug. The ticket slot is optional in this template, so the name reads both ways and the template alone can't choose.

## Fix

Choose the reading with something outside the template: the change's recorded ticket, or a lookup against the tracker. Or make `pr-ticket-link` a warning when the ticket came only from a branch number.
