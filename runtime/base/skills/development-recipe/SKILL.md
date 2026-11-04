---
name: development-recipe
description: 'The method for the development stage of a full-lane change: stay in scope, map each criterion to a test, run the inner loop, and pause on a decision. Use when you are the paqad development stage agent.'
metadata:
  model_tier: reasoning
  cacheable: 'false'
  output_format: markdown
  paqad-meta: skill.meta.yaml
---

## What It Does

Gives the development stage one method: check scope against the frozen spec, map criteria to tests, and keep the inner test loop small.

## Use This When

You are the paqad stage agent for this stage. Your injected copy is the truth for this stage; the source skills it copies stay for their other workflows.

## Inputs

- The request, `plan.json` and `specification.json` from `paqad-ai stage begin development`.

## Procedure

1. Restate the request and its acceptance criteria in two lines at the top of your return.
2. Implement only the requested feature behavior and avoid unrelated refactors.
3. Check scope before each area: compare what you are about to change with the frozen spec only. Outside it, stop and open a decision.
4. For each criterion, pick the smallest test layer that proves it, reuse existing test files first, and name the criterion id in the test name or its describe block, so `scripts/check-ac-map.mjs` can find it. A criterion with `proof: manual` or `proof: visual` needs no test.
5. Inner loop: run only the tests for the files you changed (for vitest, `vitest related <files>`).
6. On a business choice, run `paqad-ai decision create`, return `paused: D-<id>` at once, and wait to be resumed with the answer.
7. End with `paqad-ai stage end development --agent paqad-development`. It runs `scripts/check-ac-map.mjs` and refuses when a criterion has no test, printing which.

## Read This Path

- For the full scope method, read `runtime/base/skills/scope-check/SKILL.md` under the install directory that `.paqad/framework-path.txt` names.
- For the full test mapping method, read `runtime/base/skills/test-per-ac-planner/SKILL.md` under the install directory that `.paqad/framework-path.txt` names.

## Output Contract

- The source and test edits, and `rules-loaded.json`.
- Every automated criterion named by at least one test.

## Escalate / Stop Conditions

- A change the spec does not cover: open a decision. A recipe never resolves one.
