---
name: business-logic-abuse-review
description: 'Derives abuse cases from module docs and checks them against tests and runtime evidence. Use when docs describe stateful workflows, approvals, payments, exports, retries, invites or any action abusable without breaking auth.'
metadata:
  model_tier: reasoning
  cacheable: 'false'
  output_format: markdown
  paqad-meta: skill.meta.yaml
---

## What It Does

Turns business workflow descriptions into concrete abuse hypotheses so pentest reports can cover replay, bypass, approval skipping, and invalid transitions with project context.

## Use This When

When module docs describe stateful workflows, approvals, payments, exports, retries, invites, or any action that can be abused without breaking auth.

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

- Match `assets/output.template.md`: `## Findings`, `### {{module}}: {{abuse-case-tag}}`, with `Module:`, `Step:`, `Abuse case:`, `Missing proof:`, `Reproduction:` segments.
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
