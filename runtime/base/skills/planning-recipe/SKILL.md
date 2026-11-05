---
name: planning-recipe
description: 'The method for the planning stage of a full-lane change: search for reuse, keep only the steps a criterion needs, and compile a checked plan. Use when you are the paqad planning stage agent.'
metadata:
  model_tier: reasoning
  cacheable: 'false'
  output_format: markdown
  paqad-meta: skill.meta.yaml
---

## What It Does

Gives the planning stage one method: find what already exists, keep only the steps the request needs, name the modules, and compile the plan.

## Use This When

You are the paqad stage agent for this stage. Your injected copy is the truth for this stage; the source skills it copies stay for their other workflows.

## Inputs

- The request text from `paqad-ai stage begin planning`.
- The module docs and the instruction docs for the area you plan to change.

## Procedure

1. Restate the request and its acceptance criteria in two lines at the top of your return.
2. Keep planning scoped to the requested feature and the current repository state.
3. Search before you add: run `paqad-ai index query "<what you need>"` for each new thing the plan would add, grep when the index has nothing, and record every search under `reuse.consulted` with its source, query and hit count.
4. Under `reuse.reusing`, name each symbol you build on, with its file and how. Under `reuse.new_constructs`, justify each new thing by what you searched for.
5. Break the work into steps of one file, function or significant edit each, listing the files of each step.
6. Give every step a `classification`: `ac-satisfying` or `necessary-setup` keeps it, `scaffolding` or `over-build` means drop it or name a leaner form. Delete what you would drop before you compile.
7. Attribute each step to its module with `docs/instructions/rules/module-map.yml` when the project has one.
8. Write the template under `.paqad/tmp/` and run `paqad-ai plan compile <plan-template.json>`. It runs the `check-plan.mjs` check itself and refuses a plan that fails, printing the errors. Fix them and run it again.

## Read This Path

- When the plan touches more than one module, read `base/skills/cross-module-impact-scanner/SKILL.md` under the install directory that `.paqad/framework-path.txt` names.

## Output Contract

- `plan.json` from `paqad-ai plan compile`, with a reuse section and a classification on every step.
- A plan with zero `reuse.consulted` entries is refused: a plan must record what existing code was checked.

## Escalate / Stop Conditions

- A business choice the request leaves open: run `paqad-ai decision create` and return `paused: D-<id>`. A recipe never resolves one.
