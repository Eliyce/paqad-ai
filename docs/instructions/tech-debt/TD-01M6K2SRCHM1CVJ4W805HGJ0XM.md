---
id: "TD-01M6K2SRCHM1CVJ4W805HGJ0XM"
title: "The config preservation rule doesn't name the shipped-line removal"
kind: "gap"
severity: "low"
status: "closed"
files:
  - "docs/instructions/rules/coding/config-visibility.md"
found_in:
  change: "01M6JW1PAC0MRPEFDFXYVC56MX"
  issue: "840"
  stage: "review"
found_by: "review"
session: "f5433cfe-6124-45e1-b2f9-d7cda76f2141"
created_at: "2026-11-04T10:48:41.590Z"
reopened_at: null
issue: null
closed_reason: "The rule now names when update may rewrite a team file, including the stale workflow entries in src/core/shipped-workflow-entries.ts."
---

## What

## What

`docs/instructions/rules/coding/config-visibility.md` says update must keep a team's values and must not rewrite them. `paqad-ai update` now removes team lines from `feature-development/workflow.yaml` when their wording matches what paqad once shipped for that stage. The owner ruled for this, and the update docs describe it, but the rule still states no exception, so a later reviewer could read the removal as a violation.

## Fix idea

Add one sentence to the rule naming this exception and pointing to `src/core/shipped-workflow-entries.ts`.
