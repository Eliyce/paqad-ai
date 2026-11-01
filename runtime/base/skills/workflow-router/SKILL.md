---
name: workflow-router
description: Match raw prompts to canonical framework workflows before any pipeline phases begin.
metadata:
  model_tier: fast
  cacheable: 'true'
  output_format: yaml
  paqad-meta: skill.meta.yaml
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
