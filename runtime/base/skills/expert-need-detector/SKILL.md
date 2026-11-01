---
name: expert-need-detector
description: 'Picks which on-call domain experts from the roster (db-expert, security-auditor, ux-ui-analyst, integration-architect and the rest) a spec pipeline request needs, and answers whether a named expert is needed at all, as a roster-constrained JSON need artifact the pipeline validates and records. It is the one model call that replaces a deterministic signal-scorer, because no script can tell which expert a request needs without false signals. Use when the spec pipeline runs with the expert roster on and someone asks which experts or specialists to seat, pick or detect for a grounded request, or whether it needs a particular expert, after spec pipeline start and before the craft step (phase 2; the TS guard is src/spec-pipeline/experts/need.ts).'
metadata:
  model_tier: fast
  cacheable: 'false'
  output_format: json
  paqad-meta: skill.meta.yaml
---

## What It Does

Reads the request and the pipeline's S0 grounding slice and decides **which domain experts the
spec needs**: a database expert when the request touches the data model, a security expert when
it touches auth or a trust boundary, a UI expert when it touches a screen, and so on. It returns
a small JSON artifact naming each needed expert and, in one plain sentence, why it fired.

This model call **replaces a deterministic signal-scorer**: a script cannot reliably tell which expert a request needs (file-path and keyword
heuristics emit false signals both ways), so the judgement is the model's. The script's job is
only to VALIDATE the result against the roster, never to make it. Nothing needed ⇒ an empty
list ⇒ zero experts, zero cost.

## Use This When

- The spec pipeline is running with the expert roster enabled (`spec_pipeline_experts_enabled`),
  after `spec pipeline start` has grounded and labelled the request, and before the craft step.

Do **not** run this when the experts flag is off; the skill never runs then.

## Inputs

- `request_text`: required. The request being specced.
- `grounding`: required. The S0 grounding (references and business terms): the evidence for
  which areas the request touches. Decide from THIS, not from the whole repo. Get the request,
  the grounding and the label in one go with `paqad-ai spec pipeline experts context`; they are
  not files you read or write yourself.
- `roster`: optional. The allowed expert roles; defaults to the framework roster. You may name
  **only** roles in it. The roster and each role's remit are in
  `references/roster.md`; read it before you select.

## Procedure

1. Read the request and the grounding terms/references. Identify the concrete areas the request
   touches (a table or migration, an auth path, a screen, an integration, an infra change).
2. For each area that clearly needs a specialist, select the matching expert role **from the
   roster only**. Judge need, not certainty-of-self: pick an expert because the work plainly sits
   in its domain, never "to be safe".
3. Select nothing from the on-call list when nothing clearly needs a specialist; the standing
   experts are seated for you. An empty on-call result is the common, correct outcome: it costs
   nothing downstream.
4. For each selected expert write one plain-language `reason` naming the area that triggered it
   (e.g. "adds the invoices migration", not "database concerns").
5. Emit the JSON artifact (see Output Contract) and hand it to the pipeline:
   `paqad-ai spec pipeline experts record <artifact-file>`. That command runs the deterministic
   roster guard (`src/spec-pipeline/experts/need.ts`) and refuses anything naming a role outside
   the roster; do not re-implement that check here. It writes the roster into the change's
   `experts.json`; you never write that file yourself. Each expert's brief is never a file:
   print it with `paqad-ai spec pipeline experts brief <role>` and hand it to the
   `expert-notes` skill.

## Output Contract

- A JSON object `{ "experts": [ { "role": "<roster role>", "reason": "<one plain sentence>" } ] }`.
- `experts` MAY be empty (nothing needed).
- Every `role` is one of the roster roles and every `reason` is a non-empty sentence, because the
  guard rejects the whole artifact otherwise.
- The artifact is validated by `paqad-ai spec pipeline experts record`; a role outside the roster,
  a missing reason, or a duplicate role is rejected with a one-line message and nothing recorded.

## Escalate / Stop Conditions

- Never name a role outside the roster: the guard rejects it and the run stops.
- Never invent a "general" or "misc" expert; if nothing in the roster fits, select nothing.
- Do not read the whole repo to decide: decide from the request and the grounding slice only
  (the per-expert briefing is retrieved later, per expert, and is never the whole project).

## Resources

- `references/roster.md`: the roster and each expert's remit.
- `runtime/base/skills/expert-need-detector/agents/openai.yaml`: agent interface metadata.
- `src/spec-pipeline/experts/need.ts`: the deterministic roster guard (validates this output).
- `src/spec-pipeline/experts/roster.ts`: the canonical roster (subset of `AGENT_ROLES`).
- `paqad-ai spec pipeline experts context`: prints the request, grounding and label this skill reads.
