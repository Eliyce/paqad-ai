---
name: workflow-router
description: Match raw prompts to canonical framework workflows before any pipeline phases begin.
model_tier: fast
request_routing:
  - priority: 250
    target_workflow: pentest-retest
    patterns:
      - pentest retest
      - pentest-retest
      - retest pentest
      - retest security findings
  - priority: 240
    target_workflow: pentest
    patterns:
      - run a pentest
      - run pentest
      - penetration test
      - security review
      - security test
  - priority: 230
    target_workflow: root-cause-analysis
    patterns:
      - root cause analysis
      - root-cause-analysis
      - postmortem
      - post mortem
      - incident analysis
  - priority: 225
    target_workflow: module-documentation
    patterns:
      - create module documentation
      - generate module docs
      - create per-module docs
      - now create the module documentation
      - generate module documentation
      - create module docs
  - priority: 220
    target_workflow: documentation-update
    patterns:
      - create documentation
      - created documentation
      - create documenation
      - created documenation
      - generate documentation
      - update documentation
      - refresh documentation
      - build documentation
  - priority: 210
    target_workflow: project-question
    patterns:
      - how does
      - what is
      - why does
      - where is
      - explain
      - walk me through
  - priority: 180
    target_workflow: cleanup
    patterns:
      - cleanup
  - priority: 175
    target_workflow: refactor
    patterns:
      - refactor
  - priority: 170
    target_workflow: migration
    patterns:
      - data migration
      - schema migration
      - migration
  - priority: 165
    target_workflow: bug-fix
    patterns:
      - fix
      - bug
      - repair
  - priority: 160
    target_workflow: research
    patterns:
      - research
  - priority: 155
    target_workflow: planning
    patterns:
      - plan
      - brief
      - outline
      - strategy
  - priority: 150
    target_workflow: editing
    patterns:
      - rewrite
      - revise
      - polish
      - edit
  - priority: 145
    target_workflow: writing
    patterns:
      - write
      - content
      - copy
      - article
  - priority: 140
    target_workflow: feature-development
    patterns:
      - implement
      - build
      - add
      - feature
cacheable: true
cache_key_inputs:
  - request_text
output_format: yaml
input_schema:
  request_text:
    type: string
    required: true
    description: Raw user request to route.
  project_profile_path:
    type: path
    required: false
    description: Canonical project profile used to validate routing context.
---

## What It Does

Routes the incoming request into one canonical workflow before the pipeline starts so prompt aliases and typo variants live in skill content instead of hardcoded TypeScript checks.

## Use This When

Use this first for every incoming request. If no routing rule matches, stop and return no workflow match instead of guessing.

## Inputs

- Read the raw request text first.
- Check the canonical project profile only when it changes whether a matched workflow is valid.
- Check project workflow templates when a rule targets `custom:{workflow-name}`.

## Procedure

1. Pipe the raw request into `scripts/route-request.sh` — it lowercase-normalizes, walks `assets/routing-rules.txt` (priority ordered, longest-pattern tiebreak), and emits the YAML decision.
2. When a rule targets `custom:{workflow-name}`, the LLM confirms the template exists before returning it (script does not).
3. Validate with `scripts/lint-output.sh`.

## Output Contract

- Match `assets/output.template.yaml`: `workflow:`, `reason:`, `matched_rule:` (or `workflow: none` + `reason:` only).
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Do not invent a workflow when no rule matches.
- Warn when a custom workflow target is missing from the project.

## Resources

- `references/routing-rules.md`
- `scripts/route-request.sh`
- `scripts/lint-output.sh`
- `assets/routing-rules.txt`
- `assets/output.template.yaml`
- `agents/openai.yaml`
