---
name: root-cause-analysis
description: Generate a canonical RCA artifact for an incident or failure.
model_tier: reasoning
triggers:
  - workflow:
      - root-cause-analysis
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  request_text:
    type: string
    required: true
    description: Incident or problem statement to analyze.
  stack_snapshot_path:
    type: path
    required: false
    description: Optional stack snapshot to ground the investigation.
---

## What It Does

Produces a canonical root cause analysis document with a fixed section set so investigations stay comparable across stacks and incidents.

## Use This When

Use this when the workflow is explicitly root-cause-analysis and the team needs a durable artifact that captures the problem, evidence, root cause, and solution in one place.

## Inputs

- Read the incoming problem statement first.
- Read the current stack snapshot, logs, traces, tests, or incident notes when available.
- Use stack-specific tools and rules only as investigation inputs, not as a reason to vary the RCA structure.

## Procedure

1. Restate the problem clearly and identify the affected stack context.
2. Capture symptoms, impact, and timeline evidence before writing a conclusion.
3. Separate confirmed root causes from contributing factors and open questions.
4. Record the remediation in the `Solution` section even when it is proposed rather than already deployed.
5. End with verification steps and follow-up actions needed to prevent recurrence.

## Output Contract

- Match `assets/output.template.md` exactly: 8 canonical sections in the order from `assets/section-order.txt`.
- `## Solution` is always present, even when the remediation is proposed not deployed.
- Output must pass `scripts/lint-output.sh` (exit 0) — it enforces the section order strictly.

## Escalate / Stop Conditions

- Ask when there is not enough evidence to distinguish root cause from speculation.
- Warn when the available evidence conflicts across logs, tests, or runtime observations.
- Do not present a guess as a confirmed root cause.

## Resources

- `references/rca-sections.md`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/section-order.txt`
- `agents/openai.yaml`
