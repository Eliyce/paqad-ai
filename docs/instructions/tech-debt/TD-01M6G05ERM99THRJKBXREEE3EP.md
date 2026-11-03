---
id: "TD-01M6G05ERM99THRJKBXREEE3EP"
title: "Skill description catalog (~30,063 chars) is over the 8,000-char authoring budget, which predates #791"
kind: "debt"
severity: "low"
status: "open"
files:
  - "runtime/base/skills"
found_in:
  change: "01M6EX814WG84WBN1YCW034G48"
  issue: "791"
  stage: "checks"
found_by: "paqad-review"
session: "6e440033-f345-4ab7-baee-663c65ece92f"
created_at: "2026-11-03T06:04:55.933Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The skill-authoring release stage reports that the installed skill catalog's descriptions total about 30,063 characters against `authoring_description_budget_chars` = 8,000. The base skills in runtime/base/skills alone already total about 12,800 description characters, and they were over 8,000 before this change. The change adds git-workflow (about 700 characters), and documentation-workflow's description length is unchanged (341). Either the budget or the descriptions need a pass. This change does not cause it.
