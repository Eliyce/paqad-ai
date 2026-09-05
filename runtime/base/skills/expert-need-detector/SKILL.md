---
name: expert-need-detector
description: Decide, from the request and the S0 grounding, which domain experts (db, security, ui, ...) the spec pipeline needs — the one model call that replaces a deterministic signal-scorer, because no script can reliably tell which expert a request needs without emitting false signals. Emits a roster-constrained JSON need artifact the pipeline script validates and records. Phase 2 of the spec pipeline (issue #521). TS guard is `src/spec-pipeline/experts/need.ts`.
model_tier: fast
triggers:
  - workflow:
      - feature-development
cacheable: false
cache_key_inputs: []
output_format: json
input_schema:
  request_text:
    type: string
    required: true
    description: The user's request being specced.
  grounding:
    type: object
    required: true
    description: The S0 grounding artifact (grounding.json) — references + business terms for the touched area.
  roster:
    type: string[]
    required: false
    description: The allowed expert roles. Defaults to the framework roster; the detector may name only these.
---

## What It Does

Reads the request and the pipeline's S0 grounding slice and decides **which domain experts the
spec needs** — a database expert when the request touches the data model, a security expert when
it touches auth or a trust boundary, a UI expert when it touches a screen, and so on. It returns
a small JSON artifact naming each needed expert and, in one plain sentence, why it fired.

This is the model call that **replaces a deterministic signal-scorer** (issue #521, the "one
change"): a script cannot reliably tell which expert a request needs — file-path and keyword
heuristics emit false signals both ways — so the judgement is the model's. The script's job is
only to VALIDATE the result against the roster, never to make it. Nothing needed ⇒ an empty
list ⇒ zero experts, zero cost.

## Use This When

- The spec pipeline is running with the expert roster enabled (`spec_pipeline_experts_enabled`),
  after S0 grounding has produced `grounding.json` and before the craft step.

Do **not** run this when the experts flag is off — with it off the pipeline is byte-identical to
v1 and this skill never runs.

## Inputs

- `request_text` — required. The request being specced.
- `grounding` — required. The S0 `grounding.json` (references + business terms) — the evidence
  for which areas the request touches. Decide from THIS, not from the whole repo.
- `roster` — optional. The allowed expert roles; defaults to the framework roster. You may name
  **only** roles in it. The roster and each role's remit are in
  `runtime/base/skills/expert-need-detector/references/roster.md`.

## Procedure

1. Read the request and the grounding terms/references. Identify the concrete areas the request
   touches (a table or migration, an auth path, a screen, an integration, an infra change).
2. For each area that clearly needs a specialist, select the matching expert role **from the
   roster only**. Judge need, not certainty-of-self: pick an expert because the work plainly sits
   in its domain, never "to be safe".
3. Select nothing when nothing clearly needs a specialist. An empty result is the common, correct
   outcome — it costs nothing downstream.
4. For each selected expert write one plain-language `reason` naming the area that triggered it
   (e.g. "adds the invoices migration", not "database concerns").
5. Emit the JSON artifact (see Output Contract) and hand it to the pipeline:
   `paqad-ai spec pipeline experts record <artifact-file>`. That command runs the deterministic
   roster guard (`src/spec-pipeline/experts/need.ts`) and refuses anything naming a role outside
   the roster — do not re-implement that check here.

## Output Contract

- A JSON object `{ "experts": [ { "role": "<roster role>", "reason": "<one plain sentence>" } ] }`.
- `experts` MAY be empty (nothing needed).
- Every `role` MUST be one of the roster roles; every `reason` MUST be a non-empty sentence.
- The artifact is validated by `paqad-ai spec pipeline experts record`; a role outside the roster,
  a missing reason, or a duplicate role is rejected with a one-line message and nothing recorded.

## Escalate / Stop Conditions

- Never name a role outside the roster — the guard rejects it and the run stops.
- Never invent a "general" or "misc" expert; if nothing in the roster fits, select nothing.
- Do not read the whole repo to decide — decide from the request and the grounding slice only
  (the per-expert briefing is retrieved later, per expert, and is never the whole project).

## Resources

- `runtime/base/skills/expert-need-detector/references/roster.md` — the roster and each expert's remit.
- `runtime/base/skills/expert-need-detector/agents/openai.yaml` — agent interface metadata.
- `src/spec-pipeline/experts/need.ts` — the deterministic roster guard (validates this output).
- `src/spec-pipeline/experts/roster.ts` — the canonical roster (subset of `AGENT_ROLES`).
- the spec-pipeline S0 grounding step — produces the `grounding.json` this skill reads.
