---
name: site-map-gap-analysis
description: Turn the graph invariants and verification verdicts into stable SM-* findings and a gap report, so the map's problems are triaged, evidenced, and each carry a concrete fix.
model_tier: medium
triggers:
  - workflow:
      - site-map
cacheable: false
cache_key_inputs: []
output_format: json
input_schema:
  run_bundle:
    type: path
    required: true
    description: The run bundle whose invariants and verdicts become SM-* findings.
---

## What It Does

Converts the engine's graph invariants (orphans, dead ends, guard-less backstage surfaces,
broken cross-references) and the verifier's confirmed verdicts into `SM-*` findings, then
composes the gap report. Every finding is content-addressed, evidenced, and carries a concrete
fix — nothing here is a vague observation.

## Use This When

Use this after verification, once invariants and verdicts exist. It produces the findings the
receipt and the retest depend on.

## Inputs

- The engine's graph invariants and the finding index in the run bundle.
- The verifier's confirmed verdicts from `map-verification`.
- Read `references/finding-composition.md` before writing a finding.

## Procedure

The findings come from the engine's invariants and the confirmed verdicts — never from your own
fresh reading of the code.

1. Read the engine's invariants and finding index; each already carries a category and evidence.
2. Fold in the confirmed Tier-B verdicts, dedup against the existing findings, and reuse
   `finding-normalizer` so ids and severities follow the shared vocabulary.
3. Compose the gap report: findings ordered by severity, each with its `SM-<hash8>` id, category,
   evidence, and a concrete fix.

## Output Contract

- A JSON object `{ findings: [{ id, category, severity, evidence, suggestion, affected_files }], summary }`.
- Every finding id is a content-addressed `SM-<hash8>`; the category is a field
  (`SM-ADD | SM-REMOVE | SM-EDGE-STALE | SM-GUARD-DRIFT | SM-ORPHAN | SM-DEADEND | …`).
- Every finding carries resolving evidence and a concrete `suggestion`.

## Escalate / Stop Conditions

- Never restate a finding the engine or a confirmed verdict did not produce. Absence of a finding
  is not a finding.
- Never expose a secret's bytes in evidence — cite `file:line`, rule, and fingerprint only.
- A finding with no concrete fix is incomplete; state the exact remediation or do not ship it.

## Resources

- `references/finding-composition.md`
- `agents/openai.yaml`
