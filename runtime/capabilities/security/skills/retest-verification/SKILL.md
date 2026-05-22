---
name: retest-verification
description: Re-evaluate prior pentest findings against fresh local evidence.
model_tier: reasoning
triggers:
  - workflow:
      - pentest-retest
cacheable: false
cache_key_inputs:
  - docs/pentest/**/*.json
output_format: markdown
input_schema:
  source_report_path:
    type: path
    required: true
    description: Source pentest sidecar to retest.
  fresh_evidence_paths:
    type: path[]
    required: false
    description: New evidence collected during the retest run.
---

## What It Does

Replays prior pentest findings against fresh project evidence so retest reports can classify each finding as fixed, still open, or requiring manual verification.

## Use This When

Use this only for the `pentest-retest` workflow when a prior pentest report has already identified findings to verify.

## Inputs

- Read the source pentest sidecar first.
- Read `references/retest-status-rules.md` before assigning statuses.
- Read fresh evidence gathered during the current retest run.

## Procedure

1. Run `scripts/load-source-findings.sh <sidecar.json>` — validates the schema and emits one JSON row per finding to iterate over.
2. For each id, gather fresh code/docs/advisory/runtime evidence and pick a status from `assets/status-vocabulary.txt` (`fixed | still-open | needs-manual-verification`).
3. New gaps (not in the source report) belong in a separate report; never silently merge them here.
4. Format per `assets/output.template.md`; validate with `scripts/lint-output.sh <retest.md> <sidecar.json>` — fails if any id is invented.

## Output Contract

- Match `assets/output.template.md`: `## Retest Decisions` with `### {{id}} → {{status}}` per finding plus Original title, Severity, Fresh evidence, Reasoning.
- Status must be `fixed | still-open | needs-manual-verification`.
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when the source report sidecar is missing fields required to replay a finding.
- Warn when fresh evidence is blocked and the finding depends on runtime validation.
- Do not invent a fixed status when the current evidence is merely absent.

## Resources

- `references/retest-status-rules.md`
- `scripts/load-source-findings.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/status-vocabulary.txt`
- `agents/openai.yaml`
