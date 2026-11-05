---
name: review-recipe
description: 'The method for the review stage of a full-lane change: read the machine digest, judge the diff against the frozen spec, and record ordered findings. Use when you are the paqad review stage agent.'
metadata:
  model_tier: reasoning
  cacheable: 'false'
  output_format: markdown
  paqad-meta: skill.meta.yaml
---

## What It Does

Gives the review stage one risk-first method and the shape its findings must take.

## Use This When

You are the paqad stage agent for this stage. Your injected copy is the truth for this stage; the source skills it copies stay for their other workflows.

## Inputs

- The frozen spec text and the review digest text from `paqad-ai stage begin review`.
- The diff of the change.

## Procedure

1. Restate the request and its acceptance criteria in two lines at the top of your return.
2. Review the change against correctness, regressions, and rollback risk before treating it as complete.
3. Confirm or contest each machine finding in the digest. Cite the digest rows in your findings, by file or by rule id.
4. Judge the diff in this order: correctness and safety, rollback and migration, contract and compatibility, verification gaps, documentation drift. Mention style only when it raises risk.
5. Rank findings from worst to least. A blocker comes first, then major, then minor. Each names its file and what must change.
6. Fill the review template under `.paqad/tmp/` and run `paqad-ai review record <review-template.json>`. It runs the `lint-findings.mjs` check itself and refuses a template that fails, printing the errors. It also refuses findings that are all judgment when the digest has a machine row.

## Read This Path

- For the full review method and its output template, read `base/skills/adversarial-review/SKILL.md` under the install directory that `.paqad/framework-path.txt` names.

## Output Contract

- `review.json` from `paqad-ai review record`, with findings in rank order, each citing a file or a digest row.

## Escalate / Stop Conditions

- A finding that implies unsafe rollout, data loss or broken customer behaviour: verdict blocked, and say so.
