---
id: "TD-01M6RRS3C9SWWNK95C9NZR4NMD"
title: "A stage agent that opens the change gets no recipe-injected row, so the gate reports no proof"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "runtime/hooks/stage-agent-start.mjs"
  - "src/cli/commands/stage.ts"
  - "src/stage-isolation/stage-brief.ts"
found_in:
  change: "01M6RF9KPAM4XSEYPVGBBWZP70"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "8227e3c6-8b8e-4b12-af7a-b6ea0a107fe9"
created_at: "2026-11-06T15:49:00.901Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

A stage agent that opens the change itself gets no `recipe-injected` row, so the completeness gate reports that its recipe has no proof, even when the recipe was sent.

Order on the one-click earlier answers change:

- `stage-agent-start` seeded the planning agent at 13:03:12 (`.paqad/logs/hooks.log` line 407), and only then calls `recordRecipeInjected`.
- `recordRecipeInjected` returns false without a log line when `currentFeature` is null (`src/stage-isolation/stage-brief.ts:397-398`). The change did not exist yet.
- The agent's `paqad-ai stage begin` opened the change at 13:03:16.
- Nothing records the row later. `stage begin` does not retry, and only `stage brief` (`src/cli/commands/stage.ts:144`) records it again.

Every later stage of that change has the row. An earlier change whose orchestrator opened the change before dispatching planning has it for planning too. The stage brief tells agents to use `stage begin` first, so this repeats for any change opened inside its first stage agent.

The row is proof of delivery only. Here the hook logged a seed with no "did not fit" note and the planning agent wrote two `skill-used` rows, so nothing shows the recipe was skipped, but nothing proves it was sent either.

Fix direction: have `stage begin` record the row after it opens the change, or open the change before the first dispatch. Log the false return either way.
