---
name: adversarial-review
description: Perform rigorous, risk-first review after design and implementation.
model_tier: reasoning
triggers:
  - risk:
      - medium
      - high
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  request_text:
    type: string
    required: true
    description: Accepted request or change summary.
  diff_paths:
    type: path[]
    required: true
    description: Changed artifacts to review.
  verification_summary:
    type: string
    required: false
    description: Claimed verification evidence.
---

## What It Does

Runs a risk-first review that looks for correctness defects, rollback hazards, missing coverage, and weak assumptions before work is treated as complete.

## Use This When

Use this after design or implementation when the change is medium or high risk, customer-facing, security-sensitive, or hard to roll back safely.

## Inputs

- Read the request, accepted plan, code or doc diffs, and any claimed verification results.
- Read the most relevant canonical docs for the changed behavior.
- Read `references/review-dimensions.md` before structuring findings.

## Procedure

1. Run `scripts/digest-evidence.sh` to flatten `.paqad/session/verification-evidence.json` into a `gate | category | file:line | ac_id | message` table; cite this table directly when anchoring findings.
2. Review the diff and digest against the dimensions in `references/review-dimensions.md` — correctness, safety, performance, docs drift, verification sufficiency.
3. Prioritize user-visible failure, data corruption, migration risk, and contract breakage above style.
4. Draft the output following `assets/output.template.md`. Severity tags must come from `assets/severity-ranks.txt`. Order findings non-increasing by severity.
5. Validate with `scripts/lint-findings.sh` before returning — exit 0 means the structural contract is met.

## Output Contract

- Match `assets/output.template.md`: `## Findings` heading, one bullet per finding tagged `**Critical|High|Medium|Low**`, each citing concrete `file:line` (or gate name) and ending in a `Required action:` segment. Optional `## Open Questions` section.
- Output must pass `scripts/lint-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Block completion when a finding implies unsafe rollout, data loss, or broken customer behavior.
- Ask when the review depends on environment details or hidden rollout assumptions that are not present.
- Do not dilute confirmed defects with speculative style commentary.

## Resources

- `references/review-dimensions.md`
- `scripts/digest-evidence.sh`
- `scripts/lint-findings.sh`
- `assets/output.template.md`
- `assets/severity-ranks.txt`
- `runtime/capabilities/coding/checklists/database-review-20pt.md`
- `agents/openai.yaml`
