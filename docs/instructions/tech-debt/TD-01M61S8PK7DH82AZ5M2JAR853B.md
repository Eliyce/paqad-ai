---
id: "TD-01M61S8PK7DH82AZ5M2JAR853B"
title: "module-map.yml has no last_updated_at, so InstructionsDocsStructureGate rejects it"
kind: "bug"
severity: "low"
status: "open"
files:
  - "docs/instructions/rules/module-map.yml"
  - "src/verification/gates/instructions-docs-structure.ts"
found_in:
  change: "01M61NGBS49BQFVVNHE5YVH0XQ"
  issue: "753"
  stage: "review"
found_by: "paqad-review"
session: "c08524c9-ca32-4dff-8570-cedfa2eac427"
created_at: "2026-10-28T17:35:00.182Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

docs/instructions/rules/module-map.yml carries no `last_updated_at` field, so InstructionsDocsStructureGate (src/verification/gates/instructions-docs-structure.ts) rejects it. This is pre-existing: `git show origin/main:docs/instructions/rules/module-map.yml | grep -c last_updated` prints 0. The parallel review and docs change only added two sources to the feature-development-workflow module through src/module-decisions/apply.ts.

## Expected

The module-map writer (src/module-decisions/apply.ts) stamps `last_updated_at` whenever it writes the map, or the gate exempts the generated module map. Add a test that the written map passes the gate.
