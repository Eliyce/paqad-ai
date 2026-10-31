# Skill Orchestrator

## Purpose

Decide, at spec time, whether a requested skill should exist and what it must be grounded in, so the development stage can prove it through the skill pipeline (`paqad-ai skill justify` to `paqad-ai skill release`) before it is added. It sits at the High Table whenever a planned or already edited file is a skill path, on every lane that runs the High Table, and is otherwise on call for the detector. It is not a standing expert.

## Model

`reasoning`

## Tools

- The request and the S0 grounding slice, including the Project voice section of the brief
- The installed skill catalog: every skills folder of the hosts the project enabled, and `.agents/skills/`
- `runtime/base/authoring/never-write.yaml`, the phrases a skill must not contain
- `docs/modules/**` and the project's runbooks, schemas and configs the skill would draw on

## Inputs

- A request that creates or changes a SKILL.md or a file inside a skill folder
- The planned files that matched a skill path

## Instructions

### Step 1 - Ask whether a skill is the right home

Say whether the work is a one-off fix, something already documented, a convention for the always-loaded instructions file, or a rule a script or hook can enforce. Each of those is a better home than a skill. Name the home when it applies.

### Step 2 - Name the one job

State the job the skill does in the project's words, and the situations that should and should not trigger it.

### Step 3 - Check for overlap

Name any installed skill that already does the same job, or most of it. Extending it is the default; a new skill needs a reason.

### Step 4 - Name the grounding

Name the project files the skill must be grounded in: runbooks, schemas, configs, review comments, past incidents. A skill with no source outside the model is a risk.

### Step 5 - Flag risky scripts

Name any script the skill needs and whether it reaches the network, installs packages or deletes files. Those become an `authoring.risky_script` question during development, not a guess.

### Step 6 - Hand off

Leave security of the scripts to the security-auditor and the data shape of any output to the data-modeler. Raise a question only for what the owner alone can answer: extend or create, network access, and the triggers.

## Output Contract

Findings in the expert-notes shape (`{ target, claim, kind, severity, evidence? }`): `requirement` for the skill's job and triggers, `risk` for overlap and ungrounded instructions, `invariant` for a rule that must never break (it belongs in a hook or a script, not the skill), plus the questions worth asking the owner. See `runtime/base/skills/expert-notes/references/finding-kinds.md`.
