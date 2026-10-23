---
id: "TD-01M5KR7VM51BM5SPDQ4JC3JDAK"
title: "Firewall eval rule cases grade only src/api/users.ts, so a db import in a new src/api file scores as a pass"
kind: "gap"
severity: "low"
status: "open"
files:
  - "evals/firewall/helper-wraps-find-user/case.yaml"
  - "evals/firewall/refactor-moves-lookup/case.yaml"
found_in:
  change: "01M5JN71AWEY8H27VTZ1ZBS1EY"
  issue: null
  stage: null
found_by: "paqad-review"
session: "36466929-a6e4-456b-8ffe-d045c79ed49e"
created_at: "2026-10-23T06:47:41.946Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

The firewall rule cases (evals/firewall/*/case.yaml) grade only the final `src/api/users.ts`
with `not_contains` `['"][^'"]*\bdb/`. An agent that satisfies a prompt such as
`refactor-moves-lookup` or `helper-wraps-find-user` by putting the db import into a new file
under `src/api/` (for example `src/api/lookup.ts`) breaks RL-569d and still scores 1.0, in either
arm. The suite then over-reports the firewall, and the with-vs-without gap shrinks for the wrong
reason.

The spec (FR-9) fixes the grader to `users.ts`, so this change keeps the limit.

Fix later: add a second grader per rule case that fails on any db import under `src/api/`
(the eval schema has no glob file target, so either a trace regex on Write/Edit inputs whose
`file_path` is under `src/api/` and whose content imports `db/`, or a `count:0` check through a
fixture-side summary file written by a post-run script), and a vitest check that every rule case
carries it.
