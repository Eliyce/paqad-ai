---
id: "TD-01M61S8MPPFR7YXT3TRC458B71"
title: "Host task-list order (Plan, Spec, Load rules, Build, Review, Checks, Docs) does not show review and documentation sync side by side"
kind: "debt"
severity: "low"
status: "open"
files:
  - "runtime/claude-plugin/mod/desktop-view.ts"
  - "runtime/hooks/agent-entry-prompt-gate.mjs"
  - "src/onboarding/narration-contract-writer.ts"
found_in:
  change: "01M61NGBS49BQFVVNHE5YVH0XQ"
  issue: "753"
  stage: "review"
found_by: "paqad-review"
session: "c08524c9-ca32-4dff-8570-cedfa2eac427"
created_at: "2026-10-28T17:34:58.244Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

The host task-list order still lists the stages one after another as Plan, Spec, Load rules, Build, Review, Checks, Docs. The orchestrator now runs review and documentation sync side by side after Build, then checks once on the final tree, so on a parallel-capable host the Docs item is advanced before Checks and the list order no longer matches the stage order the protocol describes.

Copies that carry the old order:
- src/onboarding/narration-contract-writer.ts:12 (HOST_SURFACES_PARAGRAPH, and runtime/AGENT-ROUTER.md generated from it)
- runtime/claude-plugin/mod/desktop-view.ts:1363
- runtime/hooks/agent-entry-prompt-gate.mjs:32

## Expected

One order in all three copies that shows Review and Docs side by side, then Checks (for example Plan, Spec, Load rules, Build, Review + Docs, Checks), keeping the fast-lane list (Plan, Build, Checks) and the sequential fallback for hosts without parallel subagents. A test should pin the three copies to one constant.
