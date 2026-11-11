---
id: "TD-01M75Y09ZCG1RR11VR2WD6N2N3"
title: "Renaming the branch mid-change orphans the active change"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "src/feature-evidence/adoption.ts"
found_in:
  change: "01M75XJ2H6FDK6B37W5PKVH9N2"
  issue: null
  stage: "specification"
found_by: "orchestrator"
session: "392a0455-f02c-5717-836b-2f715b701f82"
created_at: "2026-11-11T18:30:27.472Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

Switching the checkout to a differently named branch mid-change drops the session's active change and lets the backstop open a fresh untitled fast-lane change.

- `reconcileSessionControl` (src/feature-evidence/adoption.ts) clears `active` when the change's recorded `branch` differs from HEAD (`onAnotherBranch`).
- No verb rebinds a change to a new branch name, so renaming the branch to satisfy the team's branch pattern orphans the change.
- With a stale local `main`, the stray change also diffed in commits already on origin/main and the Stop hooks judged those (skill releases, old commit messages).

Recovery used: return to the recorded branch and `paqad-ai resume --feature <ulid>`. A fix could follow a branch rename (same HEAD commit) instead of dropping the change, or offer a `feature rebind-branch` verb.
