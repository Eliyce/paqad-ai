---
id: "TD-01M6N3VSHZKCM5R2DM77RSAAY5"
title: "Nothing warns when a managed .claude/agents copy has drifted from its render"
kind: "gap"
severity: "low"
status: "open"
files:
  - ".claude/agents/paqad-development.md"
  - "src/authoring/lint/audit.ts"
found_in:
  change: "01M6KZV16XPRVAM7PK1SAZ4Y94"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "78090261-fbdb-48aa-addc-5608d7cff246"
created_at: "2026-11-05T05:45:45.765Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`lintAllAgents` now skips `.claude/agents/*` copies that carry the managed marker (`src/authoring/lint/audit.ts:432`). That is the right call for a generated copy, but nothing now says when a copy has drifted from the render. This repo's committed `paqad-*` copies are stale on purpose: `paqad-review.md` says `maxTurns: 60` where the render says 70, and `paqad-development.md` reports a blocking AG-022 when linted directly. Add a warning when a managed copy differs from what `renderStageAgentFiles` produces, and refresh the committed copies.
