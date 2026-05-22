---
name: integration-doc-maintainer
description: Maintains cross-module integration documentation
model_tier: medium
triggers:
  - scope:
      - multi-module
      - system-wide
max_lines: 200
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  changed_files:
    type: path[]
    required: true
    description: Implementation files affecting integrations.
  integration_doc_paths:
    type: path[]
    required: true
    description: Canonical integration docs to sync.
---

## What It Does

Maintains cross-module integration docs by documenting events, jobs, contracts, and fallback behavior for any change that crosses module or service boundaries.

## Use This When

Use this when a request affects published events, consumed events, background jobs, external service contracts, or any cross-module dependency.

## Inputs

- Read the current integration docs first: `integration/events.md` and `integration/contracts.md` for the affected module.
- Read the changed code and any generated event inventory or contract references.
- Read `references/integration-contract-fields.md` before updating entries.

## Procedure

1. Run `scripts/find-integration-docs.sh` to enumerate canonical events/contracts/jobs/integration docs.
2. Run `scripts/extract-events.sh <changed-files...>` to surface candidate event names; LLM confirms each before writing.
3. Update each event entry using `assets/event.template.md` (publisher, subscribers, payload, async behavior, failure expectations, versioning).
4. Update contracts with owner, versioning, and fallback/degradation behavior. Document both sides of every cross-module coupling.
5. Format report per `assets/output.template.md` and validate with `scripts/lint-output.sh`. Missing fallback / undocumented coupling → `## Consistency Warnings`, never silent.

## Output Contract

- Match `assets/output.template.md`: `## Updated Integration Docs` and `## Consistency Warnings`.
- Every updated item must name the event, contract, job, or integration path and the canonical doc path changed.
- Output must pass `scripts/lint-output.sh` (exit 0).
- Missing fallback behavior, subscriber ownership, or compatibility policy belongs under `Consistency Warnings`, never as an invented completed entry.

## Escalate / Stop Conditions

- Ask when subscriber ownership, contract versioning, or fallback policy is unclear.
- Warn when a new integration path has no documented recovery or compatibility posture.
- Do not invent event payloads or subscriber lists that are not evidenced by the code or project docs.

## Resources

- `references/integration-contract-fields.md`
- `scripts/find-integration-docs.sh`
- `scripts/extract-events.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/event.template.md`
- `runtime/templates/runner-scripts/extract-events.sh.hbs`
- `agents/openai.yaml`
