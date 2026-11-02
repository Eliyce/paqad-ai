---
id: "TD-01M6EBRBEEAKQSB02PEH75PW3E"
title: "Team setup on never prunes paqad stage agent copies whose name left the render set"
kind: "debt"
severity: "low"
status: "open"
files:
  - "src/adapters/claude/team-setup.ts"
  - "src/onboarding/stage-agent-migration.ts"
found_in:
  change: "01M6E5YHVAMKZ7PRKP36HHBJHC"
  issue: "796"
  stage: "review"
found_by: "paqad-review"
session: "6c08f2e0-301d-434c-9692-1a099573bd16"
created_at: "2026-11-02T14:49:00.600Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

When `team_bootstrap_enabled` is on, `syncTeamSetup` (src/adapters/claude/team-setup.ts:105-111) calls only `syncProjectStageAgents`, which goes through the current render set of 8 agents. It never runs `migrateProjectStageAgents`. If a later release renames or drops a stage agent, the old paqad-written `.claude/agents/paqad-<old>.md` (managed marker or a known body) stays in the repo indefinitely while team setup is on. Claude Code would still list it as a dispatchable agent.

Suggested fix: after the sync, remove any `paqad-*.md` that is not in the current render set and that `removalReason` classifies as generated. Keep symlinks and hand-edited files, as INV-1 requires. Report each removal in `report.removed` so the commit note names it.

Today there is no user impact, because the 8 current names cover every agent paqad has written so far.
