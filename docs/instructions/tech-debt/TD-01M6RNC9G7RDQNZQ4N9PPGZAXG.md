---
id: "TD-01M6RNC9G7RDQNZQ4N9PPGZAXG"
title: "Spec review reports 227 false major items and saves only the count"
kind: "bug"
severity: "low"
status: "open"
files:
  - "src/compliance/spec-review.ts"
found_in:
  change: "01M6RF9KPAM4XSEYPVGBBWZP70"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "8227e3c6-8b8e-4b12-af7a-b6ea0a107fe9"
created_at: "2026-11-06T14:49:35.462Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`paqad-ai compliance review <spec>` on the one-click earlier answers spec reproduces the 227 major items. None is real.

- 208 dangling references: all 156 FR, AC and NFR ids are defined. The detector does not read the `- FR-1:` bullet form the spec uses.
- 19 contradictions: lexical. "always" comes from the `--always` flag and the Always option, set against an unrelated "never" in another line.

The feature bundle saves only the counts in `specification.json`, so a reader cannot see this without rerunning the command.

Fix direction: recognise bullet definitions, ignore always and never inside code spans and option names, and keep the defect list or its path in the bundle.
