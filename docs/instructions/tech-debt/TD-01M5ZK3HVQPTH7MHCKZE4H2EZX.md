---
id: "TD-01M5ZK3HVQPTH7MHCKZE4H2EZX"
title: "Turn-end backstop judges a change and closes its stages while a paqad-development agent just dispatched or resumed with SendMessage is still running"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "runtime/hooks/verification-completion.mjs"
  - "src/stage-evidence/completion-deferred.ts"
found_in:
  change: "01M5YZPHCJ89TVAMWFJYS19CJ0"
  issue: "756"
  stage: "documentation_sync"
found_by: "paqad-review"
session: "924099c9-ba6b-48aa-8fc2-867026e90f4d"
created_at: "2026-10-27T21:08:51.177Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

During change 01M5YZPHCJ89TVAMWFJYS19CJ0 (session 924099c9-ba6b-48aa-8fc2-867026e90f4d) the turn-end
verification backstop judged the change while a `paqad-development` stage agent (not plugin-namespaced)
was still running. Each time it also wrote `record-repair` stage_end rows that closed the development
and documentation_sync stages mid-build. The router expects a `completion-deferred` row and no verdict.

Evidence in the bundle's stage-evidence.jsonl:

- Rows 37-41 (17:28:07Z): backstop stage_end development + documentation_sync, record-repair, then
  `verify failed verdict=incomplete; missing=[review,checks]`. Development agent aaa50cd2783e86842 had
  been resumed by the orchestrator with SendMessage and only handed back at 17:29:54Z (row 44).
- Rows 47-49 (18:17:43Z): same pattern while a freshly dispatched development agent was running
  (a433f8ed7be9c476e handed back 18:28:31Z, row 53).
- Rows 59-63 (20:46:40Z): same pattern while development agent a58475814cc20f0bb was running
  (handed back 21:01:31Z, row 68).

In each case a `completion-deferred` row appears only about 10 s later (rows 42, 50, 64), so the
deferral check works on a later Stop but not on the first Stop after the dispatch or resume.

## Likely cause

At that first Stop the hook payload's background_tasks and the ledger's started stage-agent rows do
not yet show the agent: a SendMessage resume writes no new started row, and a fresh dispatch's start
row may land after the Stop hook reads the ledger. Not the `paqad:` namespace issue in
TD-01M5KR7T2DSW4BZHHEGBD2D0NV (agent type here is plain `paqad-development`).

## Expected

No verdict and no record-repair stage_end rows while any stage agent of the change is running,
including one resumed with SendMessage. Add a fixture for each of the two shapes (resume, fresh
dispatch with the start row not yet written) that asserts a completion-deferred row.
