---
id: "TD-01M615FW3JHA1R00HCN8ZX5KBM"
title: "spec pipeline round does not surface the auto-applied module choice (FR-22 is prose-only)"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/pipeline/feature-development-policy.ts"
  - "src/spec-pipeline/round.ts"
found_in:
  change: "01M5JM36RM43G0JX8GD2PA7YTW"
  issue: "749"
  stage: null
found_by: "review"
session: "19ea5549-a6a6-420f-9c38-b10d9858ab78"
created_at: "2026-10-28T11:49:23.683Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

FR-22 says a confident, auto-applied module choice is shown in the spec round as a choice already made that the owner can change. `paqad-ai spec pipeline round` (src/spec-pipeline/round.ts `buildQuestionRound`) prints no field for it. Only prose asks for it today: SPEC_PIPELINE_INSTRUCTION and the feature-development.yaml specification instruction. The plan's reuse.consulted auto-applied entry is never read back. Possible fix: add an `auto_applied` entry (slug and score from plan.json reuse.consulted) to the round output, plus a test.
