---
name: finding-normalizer
description: Convert heterogeneous security evidence into stable pentest finding entries.
model_tier: medium
triggers:
  - workflow:
      - pentest
      - pentest-retest
cacheable: false
cache_key_inputs: []
output_format: json
input_schema:
  raw_finding_inputs:
    type: object
    required: true
    description: Structured evidence to normalize into canonical pentest findings.
---

## What It Does

Normalizes evidence from docs, tests, runtime checks, and advisory feeds into stable finding entries with consistent ids, severity, effort, and reproduction data.

Finding-id prefixes recognised by the normalizer are listed under `# code-prefix` in `assets/vocabulary.txt`:

- `PEN-*` — pentest findings (security workflow).
- `MD-*` — prospective module decisions (issue #80, Phase 1). Stored under `.paqad/decisions/module-decisions/<id>.yml`; the consumer is the Attribution Gate, not the pentest workflow. Treat severity/effort/status as advisory only for `MD-*` — the binding state machine lives in `src/module-decisions/schema.ts`.

## Use This When

Use this after raw security evidence has been collected and needs to be turned into report-ready findings or retest statuses.

## Inputs

- Read the structured evidence payload first.
- Read `references/finding-fields.md` before setting severity or effort.
- Read retest state when the workflow is `pentest-retest`.

## Procedure

1. Deduplicate findings that describe the same risk surface.
2. Pick severity, effort, and status from the closed sets in `assets/vocabulary.txt`.
3. Preserve ids and prior statuses when normalizing retest output.
4. Format the JSON exactly per `assets/output.template.json`.
5. Validate with `scripts/validate-findings.sh` — checks required fields, vocabulary, and id uniqueness.

## Output Contract

- Match `assets/output.template.json`: a JSON array of findings with `id, title, severity, effort, impact_area, evidence, reproduction, status` (plus optional `wstg_id` / `owasp_2025`).
- `severity`, `effort`, `status` must come from `assets/vocabulary.txt`.
- Output must pass `scripts/validate-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when two evidence records appear to describe overlapping but not identical risks.
- Warn when the available evidence is too thin to support the proposed severity.
- Do not inflate severity to compensate for missing detail.

## Resources

- `references/finding-fields.md`
- `scripts/validate-findings.sh`
- `assets/output.template.json`
- `assets/vocabulary.txt`
- `agents/openai.yaml`
