---
id: "TD-01M6JZJB72CEMMT64C49C4KFN9"
title: "Interactive setup can't offer the three Node project types"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/core/types/domain.ts"
  - "src/onboarding/prompts.ts"
found_in:
  change: "01M6JW1PAC0MRPEFDFXYVC56MX"
  issue: "840"
  stage: "specification"
found_by: "paqad-specification"
session: "f5433cfe-6124-45e1-b2f9-d7cda76f2141"
created_at: "2026-11-04T09:52:13.001Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

Interactive setup can't offer `node-cli`, `node-library` or `node-service`, because `DOMAIN_STACK_MAP.coding` in `src/core/types/domain.ts` stops at `kotlin-android`. Its only consumer is the stack prompt in `src/onboarding/prompts.ts`, and `tests/unit/core/types/domain.test.ts` pins the list.

Automatic detection can still give these three stacks, so only someone choosing a project type by hand is affected. The owner chose to leave setup unchanged (decision D-01M6JXAFGXYXQJCBDRQ5RGKZ97).
