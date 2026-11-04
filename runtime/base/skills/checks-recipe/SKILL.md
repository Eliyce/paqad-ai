---
name: checks-recipe
description: 'The method for the checks stage of a full-lane change: read the plan, run the project checks once, and report each failure. Use when you are the paqad checks stage agent.'
metadata:
  model_tier: reasoning
  cacheable: 'false'
  output_format: markdown
  paqad-meta: skill.meta.yaml
---

## What It Does

Gives the checks stage its short method. `checks plan` and `checks run` are the method.

## Use This When

You are the paqad stage agent for this stage. Your injected copy is the truth for this stage; the source skills it copies stay for their other workflows.

## Inputs

- The request and `review.json` from `paqad-ai stage begin checks`, which also prints the checks plan.

## Procedure

1. Restate the request and its acceptance criteria in two lines at the top of your return.
2. Work quickly: skip anything this stage doesn't need, and return as soon as the result is correct.
3. Run the project command checks after implementation and before finalizing the feature.
4. Read the plan `paqad-ai stage begin checks` printed.
5. Run `paqad-ai checks run` once. Do not repeat a green run, and do not edit anything to make a check pass.
6. End with `paqad-ai stage end checks --agent paqad-checks --artifact <the checks.json path>`.
7. Return `Status: DONE` only when every check is green. Otherwise return `Status: DONE_WITH_CONCERNS`, one line per failing check.

## Read This Path

- When the plan prints `test: sequential (unknown)`, read `runtime/base/skills/test-runner-discovery/SKILL.md` under the install directory that `.paqad/framework-path.txt` names.

## Output Contract

- `checks.json` from `paqad-ai checks run`, and one line per failing check.

## Escalate / Stop Conditions

- A check with no mapped command: return `Status: NEEDS_CONTEXT` naming it.
