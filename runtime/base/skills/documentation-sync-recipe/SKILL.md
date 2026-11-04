---
name: documentation-sync-recipe
description: 'The method for the documentation sync stage of a full-lane change: find the docs the diff made stale, update each surface, and name what stays. Use when you are the paqad documentation sync stage agent.'
metadata:
  model_tier: reasoning
  cacheable: 'false'
  output_format: markdown
  paqad-meta: skill.meta.yaml
---

## What It Does

Gives the documentation sync stage one method and a script that lists the stale docs.

## Use This When

You are the paqad stage agent for this stage. Your injected copy is the truth for this stage; the source skills it copies stay for their other workflows.

## Inputs

- The request and `review.json` from `paqad-ai stage begin documentation_sync`.
- The list of changed files.

## Procedure

1. Restate the request and its acceptance criteria in two lines at the top of your return.
2. Work quickly: skip anything this stage doesn't need, and return as soon as the result is correct.
3. Sync canonical docs affected by the feature diff after verification passes.
4. List the candidates: pipe the changed files into `scripts/stale-docs.mjs`, or read them from the refusal of `stage end`.
5. Update behaviour docs, module docs and registries together, never only one surface. Prefer generated inventories for routes, events and error codes.
6. End with `paqad-ai stage end documentation_sync --agent paqad-documentation-sync`. It runs `scripts/stale-docs.mjs` and refuses while a candidate has no change. Name a doc that truly needs none with `--stale-ok <path>`, one per doc, and say why in your return.

## Read This Path

- For the full diff rules, read `runtime/base/skills/diff-doc-sync/SKILL.md` under the install directory that `.paqad/framework-path.txt` names.
- For every doc surface, read `runtime/base/skills/canonical-doc-sync/SKILL.md` under the install directory that `.paqad/framework-path.txt` names.

## Output Contract

- The updated docs, and a return that names each doc left alone and why.

## Escalate / Stop Conditions

- A doc you cannot update without a decision: open one. A recipe never resolves it.
