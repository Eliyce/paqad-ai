---
name: skill-orchestrator
description: Takes a new or edited skill through paqad's nine gated stages, from proving the skill is needed to releasing it with evidence, so no skill is added on a hunch. Use when a change creates or edits a SKILL.md or any file in a skill folder, when the Skill Orchestrator sits at the High Table, or when paqad-ai skill status names a stage to run next.
model_tier: reasoning
triggers:
  - workflow:
      - feature-development
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  name:
    type: string
    required: true
    description: The skill name, lowercase and hyphenated, equal to its folder name.
  task:
    type: string
    required: true
    description: The job the skill is for, taken from the frozen spec and the ticket.
---

## What It Does

Runs the skill pipeline for one skill during the development stage. Each stage is a `paqad-ai skill` verb that writes one artifact into the workspace `.paqad/tmp/authoring/skills/<name>/`, and each gate reads only that artifact. A stage refuses to start while an earlier gate fails and names the command to run. The verbs never call a model: you do the runs and the writing, the verbs check what you produced.

## Use This When

- A planned or edited file is a skill path (a SKILL.md, or a file inside a skill folder) in any host's skills folder, `.agents/skills/`, or the paqad runtime skill roots.
- `paqad-ai skill status <name>` names the next stage.
- The owner answered a decision this pipeline raised and the waiting stage can resume.

Skip it for a skill the change removes: a removal gets no check.

## Inputs

- `name`: the skill name. The verbs refuse any name outside lowercase letters, digits and single hyphens.
- `task`: the job, in the project's words, from the spec and the ticket.

## Procedure

1. Run `paqad-ai skill status <name>`. It says whether the entry is `justify` (a new skill) or `improve` (an installed one) and which stage is next.
2. S0 justify. Read `references/s0-justify.md` before you run the baseline. Run the task three times without a skill, then `paqad-ai skill justify <name>`. Stop when it says no skill is needed or names a better home.
3. S1 intake. Read `references/s1-intake.md` and fill the seven fields from the spec, the ticket, the trace and the docs. Run `paqad-ai skill intake <name> intake.yaml`.
4. S2 evidence. Read `references/s2-evidence.md`, write `sources.md`, then run `paqad-ai skill evidence <name> sources.md`.
5. S3 draft. Read `references/s3-draft.md` and draft the folder outside every skills root. Run `paqad-ai skill draft <name> --dir <folder> --trace trace.md`.
6. S4 lint and tests. Read `references/s4-lint-and-tests.md`, run `paqad-ai skill lint`, write the contract tests, then `paqad-ai skill test <name>`.
7. S5 evals. Read `references/s5-evals.md`. Run `paqad-ai skill eval plan <name>`, run what it prints, grade with `references/agents/grader.md`, then `paqad-ai skill eval record <name>`.
8. S6 trigger. Read `references/s6-trigger.md`, then `paqad-ai skill trigger plan` and `paqad-ai skill trigger record`.
9. S7 release. Read `references/s7-release.md` and run `paqad-ai skill release <name>`.
10. S8 operate, later and in use. Read `references/s8-operate.md` for learn, drift and catalog.

Checklist for one pass:

- [ ] status read, entry known
- [ ] every gate passed, or the owner recorded an override
- [ ] `paqad-ai skill release` wrote the bundle record

## Output Contract

The released skill sits in the host skills folder. `.paqad/authoring/skills/<name>/evidence.json` and its `CHANGELOG.md` are tracked. The change bundle holds `skill-<name>.json` with status `passed` or `overridden`. Report to the stage in this shape:

```markdown
Skill: <name> <version>
Gates: S0 passed, S1 passed, S2 passed, S3 passed, S4 passed, S5 passed, S6 passed
Evidence: .paqad/authoring/skills/<name>/evidence.json
Decisions: <ids, or none>
```

## Escalate / Stop Conditions

- Ask the owner only through the decision packets the verbs raise: overlap with an installed skill, a risky script, an intake field nothing answers, an improvement to a skill in use, a retirement, and an override.
- A gate the skill cannot pass is not a question. The verbs record it in `.paqad/ledger/authoring/defects.jsonl` and print the receipt line; keep the skill out of every skills root.
- A secret in the skill stops the pipeline until the value is removed. It can never be overridden.
- Refuse a draft whose instructions differ from its stated purpose, send data out, or get around a control: run `paqad-ai skill draft <name> --refuse "<why>"`.

## Gotchas

- `paqad-ai skill test` sets `PAQAD_SKILL_UNDER_TEST` to the draft folder for the test run, so the contract tests can load a script that is not released yet. Fall back to the host path when it is unset.
- A rule that has to hold every time belongs in a hook or a rules-as-scripts check, not in a skill. S0 ends with that proposal.
- Write nothing from `runtime/base/authoring/never-write.yaml`; the lint blocks every phrase on it.

## Resources

- `references/s0-justify.md`: the baseline runs and the four better homes.
- `references/s1-intake.md`: the seven intake fields and the test type per class.
- `references/s2-evidence.md`: the sources table, overlap and the catalog budget.
- `references/s3-draft.md`: the drafting rules and the trace format.
- `references/s4-lint-and-tests.md`: the lint rules and the seven contract tests.
- `references/s5-evals.md`: cases, arms, tiers and the revision loop.
- `references/s6-trigger.md`: the trigger queries, the split and the description rules.
- `references/s7-release.md`: release, overrides and the portable copy.
- `references/s8-operate.md`: learn, drift and catalog.
- `references/agents/grader.md`: the brief for the grader agent in S5.
- `references/agents/comparator.md`: the brief for the blind comparator in S5.
- `references/agents/analyzer.md`: the brief for the analyst in S5.
- `references/agents/NOTICE`: the Apache 2.0 notice for the three adapted briefs.
- `agents/openai.yaml`: the display name and short description for hosts that read it.
