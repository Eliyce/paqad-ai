---
name: business-logic-abuse-review
description: Derive abuse cases from module docs and validate them against tests and runtime evidence.
model_tier: reasoning
triggers:
  - workflow:
      - pentest
cacheable: false
cache_key_inputs:
  - docs/modules/**
  - tests/**
output_format: markdown
input_schema:
  module_doc_paths:
    type: path[]
    required: true
    description: Canonical module docs that describe workflows and state transitions.
  runtime_artifact_paths:
    type: path[]
    required: false
    description: Optional runtime artifacts that help validate the abuse hypotheses.
---

## What It Does

Turns business workflow descriptions into concrete abuse hypotheses so pentest reports can cover replay, bypass, approval skipping, and invalid transitions with project context.

## Use This When

Use this when module docs describe stateful workflows, approvals, payments, exports, retries, invites, or any action that can be abused without breaking auth.

## Inputs

- Read the workflow and state-related module docs first.
- Read `references/abuse-cases.md` before selecting hypotheses.
- Read tests and runtime artifacts that could confirm or refute those hypotheses.

## Procedure

1. Run `scripts/find-workflow-docs.sh` to enumerate candidate workflow/state docs.
2. Extract state changes, approvals, and high-value actions from those docs.
3. For each, pick an abuse-case tag from `assets/abuse-case-categories.txt` (replay, double-submit, invalid-transition, bypass-approval, race, rollback-skip, overspend).
4. Confirm whether tests or runtime evidence cover that abuse path; record the exact missing proof.
5. Format per `assets/output.template.md` and validate with `scripts/lint-findings.sh`.

## Output Contract

- Match `assets/output.template.md`: `## Findings`, `### {{module}} — {{abuse-case-tag}}`, with `Module:`, `Step:`, `Abuse case:`, `Missing proof:`, `Reproduction:` segments.
- Output must pass `scripts/lint-findings.sh` (exit 0).
- Reproduction steps must be concrete enough for a manual retest.

## Escalate / Stop Conditions

- Ask when the workflow is clearly high-value but the module docs do not describe its state transitions.
- Warn when the docs suggest irreversible or financial actions without matching abuse-focused test evidence.
- Do not present a generic “business logic risk” without naming the exact abuse case.

## Resources

- `references/abuse-cases.md`
- `scripts/find-workflow-docs.sh`
- `scripts/lint-findings.sh`
- `assets/output.template.md`
- `assets/abuse-case-categories.txt`
- `agents/openai.yaml`
