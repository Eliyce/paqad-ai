---
name: specification-recipe
description: 'The method for the specification stage of a full-lane change: run the pipeline, write testable criteria and edge cases, and freeze. Use when you are the paqad specification stage agent.'
metadata:
  model_tier: reasoning
  cacheable: 'false'
  output_format: markdown
  paqad-meta: skill.meta.yaml
---

## What It Does

Gives the specification stage one method: the pipeline steps in order, how to write acceptance criteria and edge cases, and the High Table handback.

## Use This When

You are the paqad stage agent for this stage. Your injected copy is the truth for this stage; the source skills it copies stay for their other workflows.

## Inputs

- The request text and `plan.json` from `paqad-ai stage begin specification`.

## Procedure

1. Restate the request and its acceptance criteria in two lines at the top of your return.
2. Write or refine the feature specification before implementation when the lane includes specification.
3. Run `paqad-ai spec pipeline start` in the foreground, then each step it names, in the order it names them. Never skip a step and never poll for status.
4. After `spec pipeline experts record` seats experts, return at once with `Status: NEEDS_CONTEXT` naming every seated role. You are resumed when the table has ruled.
5. Write one flat criterion per outcome: `- AC-N: Given ..., when ..., then ... (proof: automated|manual|visual).` Keep ids stable and never reuse a removed id.
6. Walk each edge case category against the request: empty, stale, loading, retry, permission, concurrency, rollback, integration, overflow, state-skip. Keep only cases that change behaviour, docs or tests, and tie each to what absorbs it.
7. Ask the owner every open question in one round with `paqad-ai spec pipeline round`.
8. Freeze with `paqad-ai spec freeze`. It runs `scripts/check-spec.mjs` beside the quality review and refuses a spec that fails, printing the errors.

## Read This Path

- For the full criteria rules, read `runtime/base/skills/acceptance-criteria-gen/SKILL.md` under the install directory that `.paqad/framework-path.txt` names.
- For the full edge case method, read `runtime/base/skills/edge-case-detection/SKILL.md` under the install directory that `.paqad/framework-path.txt` names.

## Output Contract

- `specification.json` from `paqad-ai spec freeze`.
- Flat `AC-N` ids in given, when, then form, each with a proof tag, and an edge cases section.

## Escalate / Stop Conditions

- A question only a person can answer: put it in the spec round. A recipe never resolves a business choice.
