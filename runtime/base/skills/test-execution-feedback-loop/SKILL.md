---
name: test-execution-feedback-loop
description: For each failing test in the verification evidence, propose the smallest fix anchored to file, line, and acceptance criterion.
model_tier: reasoning
triggers:
  - process_depth:
      - graduated lane
      - full lane
  - workflow:
      - feature-development
      - bug-fix
      - refactor
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  verification_evidence_path:
    type: path
    required: true
    description: Path to .paqad/session/verification-evidence.json (schema 1.0.0 or compatible).
  acceptance_criteria_path:
    type: path
    required: false
    description: Acceptance criteria artifact for cross-checking each failure's AC id.
  changed_file_paths:
    type: path[]
    required: false
    description: Files in the current change set so confidence can be calibrated.
---

## What It Does

Reads the structured verification evidence file produced by the verifier, and for every entry in `gates[].failures[]` proposes the smallest change that would make that test pass. Each proposal is anchored to a specific file, line, AC id, and root-cause hypothesis — no prose-only suggestions and no fixes that work around the test.

The point is to collapse the typical fix-test-rerun-repeat loop from two turns into one: the model's next implementation turn can act on a structured proposal instead of re-reading raw test output.

## Use This When

Use this immediately after the verifier reports `overall_status: "fail"` and before the next implementation turn begins. Run it whenever there are at least one failure in the evidence file. Skip in the fast lane unless explicitly requested.

## Inputs

- Read the verification evidence at `verification_evidence_path` first; reject the run if `schema_version` is not `1.0.x`.
- Read the acceptance criteria artifact when supplied so each failure's `ac_id` can be cross-checked.
- Read the changed-file list to calibrate confidence (failures pointing at files outside the change set lower confidence to `low`).
- Read `references/fix-proposal-template.md` before drafting proposals so every proposal has the required fields.

## Procedure

1. Run `scripts/load-failures.sh [evidence-path]` — emits one JSON object per failure, exits 1 if schema_version is unsupported. Iterate over those rows.
2. For each failure, read an excerpt around `file:line` to confirm the cited line still exists.
3. Cross-check `ac_id` against the acceptance criteria artifact; mark `untraced` and lower confidence when the AC is missing.
4. Draft one proposal per failure (or one combined proposal when failures share a root cause) per `assets/output.template.md`.
5. Confidence: `high` only when one-line, anchored to the change set, and AC is known.
6. Validate with `scripts/lint-output.sh`.

## Output Contract

- Return a heading named `Fix Proposals`.
- For each failure (or combined group), emit a third-level heading `### Failure {N}` and the fields from `references/fix-proposal-template.md`.
- End with a summary line: `Total failures: {N} | Combined into {M} proposals | High-confidence: {H} | Defer to human: {D}`.
- When the evidence file has zero failures, return `Fix Proposals: none — verification passed.` exactly.

See `assets/output.template.md` for the canonical shape; lint enforces it.

## Escalate / Stop Conditions

- Stop when the evidence file is missing or its `schema_version` is unsupported; do not attempt to derive failures from prose.
- Warn when a failure's `failures[].file` does not exist on disk — the diff may have been reverted; recommend re-running the verifier before drafting more proposals.
- Recommend `defer to human` whenever confidence falls to `low`.
- Do not propose changes that weaken or skip the failing test.

## Resources

- `references/fix-proposal-template.md`
- `scripts/load-failures.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `agents/openai.yaml`
