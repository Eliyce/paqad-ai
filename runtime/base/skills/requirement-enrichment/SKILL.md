---
name: requirement-enrichment
description: Phrase the pipeline's clarification questions as plain-language two-layer question objects.
model_tier: fast
triggers:
  - process_depth:
      - graduated lane
      - full lane
cacheable: false
cache_key_inputs: []
output_format: json
input_schema:
  request_text:
    type: string
    required: true
    description: The user's own request wording (second-priority vocabulary source).
  grounding_terms:
    type: string[]
    required: false
    description: The S0 grounding vocabulary (glossary + module-doc headings) — the first-priority wording source.
  grounding_references:
    type: path[]
    required: false
    description: Doc/glossary refs the phrasing can cite in each question's grounded_in.
---

## What It Does

Turns the open decisions an incomplete request leaves behind into the pipeline's S2 clarification batch: a set of FR-4 two-layer question objects, each phrased in the project's own words so a non-technical owner can answer it. This is the S2 question-phrasing step of the spec pipeline (issue #512, B.5.2) — it phrases, it does not judge clarity and does not re-run the plain-language check.

## Use This When

Use this when the spec pipeline's `label` step rated the request `vague` or `okay` and unlocked a question budget, and the touched area has been grounded (S0). It is for phrasing genuine ambiguities as answerable questions, not for restating a request that is already clear.

## Inputs

- Read the S0 grounding terms and references for the touched area — they are the first-priority vocabulary.
- Read the raw request, tracker notes, and any linked issue or spec — the user's own wording is the second-priority vocabulary.
- Read `references/enrichment-checklist.md` and walk `assets/operational-checklist.txt` to find the dimensions the request leaves undecided.

## Procedure

1. Walk `assets/operational-checklist.txt` (permissions, auditability, rollback, data-retention, i18n, a11y, observability, docs, feature-flags) and `references/enrichment-checklist.md`; for every dimension the request touches but leaves undecided, hold a candidate question.
2. Keep only genuine ambiguities, within the question budget the `label` step unlocked. Drop anything the grounding or the prompt already answers.
3. Phrase each question as a two-layer object. `business_text` and every `options[]` entry draw vocabulary in priority order: (1) the S0 grounding terms, (2) the user's own prompt, (3) plain English. Given a documented term ("archived invoices"), use it — never a from-the-model synonym ("soft-deleted records").
4. Phrase `options[]` as OUTCOMES, never mechanisms: "keep trying quietly for an hour, then notify someone", never "exponential backoff". Give at least two options.
5. Where current behaviour is documented, cite it in the question ("Today, exports include hidden columns — keep that, or leave them out?").
6. Write one plain sentence of `why_it_matters`. Set `grounded_in` to the doc/glossary ref the wording came from, or `null` when it cannot be tied to project evidence. Put any internal mechanism note in `technical_note` (never shown to the user).
7. Emit the batch per `assets/output.template.md`; validate the shape with `scripts/lint-output.sh` (exit 0). Hand the file to `paqad-ai spec pipeline record questions <file>`, which runs the ledger auto-answer pre-step and persists the surviving batch.

## Output Contract

- A JSON object matching `assets/output.template.md`: `{ "questions": [ ... ] }`, where each question has `business_text` (plain string), `why_it_matters` (one sentence), `options[]` (>=2 outcome strings), `grounded_in` (a ref string or `null`), and an optional internal `technical_note`.
- `questions[]` is the only hard-required field, so the raw batch validates against the pipeline's `questions` step even before auto-answer enrichment.
- Do NOT re-implement the plain-language check here — the pipeline's `checkPlainLanguage` guards the wording (FR-4.3). Phrase for it.
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when business rules, permissions, or data-retention expectations are absent but clearly required — phrase the ask as one of these questions rather than guessing.
- Warn when the request conflicts with canonical docs or previously approved behavior.
- Do not guess regulatory, billing, or irreversible-data requirements; surface them as questions with `grounded_in` set to the governing doc.

## Resources

- `references/enrichment-checklist.md`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/operational-checklist.txt`
- `runtime/capabilities/coding/checklists/edge-cases-coding.md`
- `agents/openai.yaml`
