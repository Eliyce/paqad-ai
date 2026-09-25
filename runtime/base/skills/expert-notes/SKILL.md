---
name: expert-notes
description: Read one expert's brief and, through that expert's lens, write short request-time notes for the spec pipeline — what this request must do, must never break, and still leaves undecided — as findings plus plain-language questions. One runner skill with a lens per expert (db, security, ui, ...), so the procedure is shared and only the lens differs. The pipeline script validates the output against the roster; it never decides. Phase 2 of the spec pipeline (issue #547). TS guard is `src/spec-pipeline/experts/notes.ts`.
model_tier: reasoning
triggers:
  - workflow:
      - feature-development
cacheable: false
cache_key_inputs: []
output_format: json
input_schema:
  role:
    type: string
    required: true
    description: The expert role to write notes as — one of the pickable roster roles.
  brief:
    type: string
    required: true
    description: The brief printed by `paqad-ai spec pipeline experts brief <role>` (the request, grounding pointers, label, and granted budget).
---

## What It Does

Reads ONE expert's brief and writes that expert's request-time notes: the requirements the
request implies, the invariants it must never break, the acceptance behaviour it should show,
the risks it carries, and the questions only a human can answer. Each expert is a **lens** over
the same procedure, not a separate skill: the db-expert looks for tables, indexes and migration
safety; the security-auditor looks for who may act and who must not; the ux-ui-analyst looks for
the six screen states; and so on. The lens is the only thing that changes.

It decides from the **brief alone** — the request, the grounding pointers, the label — never the
whole repo. The pipeline script validates what comes back against the roster, assigns stable ids,
and merges it; this skill does the reading and judgement, the script does the checking.

## Use This When

- The spec pipeline is running with the expert roster on (`spec_pipeline_experts_enabled`), the
  `expert-need-detector` has named the experts, and `experts record` has put them on the roster.
  Run this skill once per expert, with the brief the `experts brief` verb prints for it.

Do **not** run this when the experts flag is off — with it off the pipeline is byte-identical to
v1 and this skill never runs. Do **not** invent a role: you write as the role in the brief.

## Inputs

- `role` — required. The expert role you are writing as. Read that role's lens in
  `references/lenses/<role>.md` (for example `references/lenses/db-expert.md`) and apply it.
- `brief` — required. Print it with `paqad-ai spec pipeline experts brief <role>`. The brief is
  never a file: it is rebuilt from the run each time, and its hash is on your roster entry in
  `experts.json`. It carries the request text, the ticket acceptance criteria when present, the
  grounding references (pointers, never file bodies), the clarity label and its signals, and the
  token budget you are granted.

## Procedure

1. Print your brief with `paqad-ai spec pipeline experts brief <role>`. Read your lens in
   `references/lenses/<role>.md`.
2. Decide from the request and the grounding **only**. Do not read the whole repo.
3. Write findings about concrete targets — a table, an endpoint, a screen, a journey step — each
   about ONE target and making ONE claim. Mark each finding's `kind` and `severity`; see
   `references/finding-kinds.md` for what each kind becomes in the spec.
4. Phrase every question as a `PipelineQuestion`: business words, options phrased as outcomes, and
   the grounding reference it is grounded in (or `null`). Ask only what the project's own docs
   cannot answer.
5. Report the tokens you spent. Stop when the budget in the brief is reached — findings may be
   empty (you looked and had nothing to add: a valid, cheap outcome).
6. Validate the file with `scripts/lint-output.sh`, then hand it to the pipeline:
   `paqad-ai spec pipeline experts notes <file>`. That runs the deterministic guard
   (`src/spec-pipeline/experts/notes.ts`) — an unknown role, kind or severity, or a question in
   jargon, is refused there; do not re-implement that check. The verb stores each finding once in
   the change's `experts.json` and your tokens on your roster entry; never write that file
   yourself.

## Output Contract

- A JSON object shaped like `assets/output.template.md`:
  `{ "notes": [ { "role", "findings": [ { "target", "claim", "kind", "severity", "evidence"? } ], "questions": [ PipelineQuestion ] } ], "tokens": { "<role>": n } }`.
- `kind` is one of `requirement | invariant | acceptance | risk | non-goal`; `severity` is one of
  `must | should | could`; `evidence` is an optional grounding reference.
- `findings` MAY be empty. `questions` MAY be empty. One note per brief you were given.
- The artifact is validated by `paqad-ai spec pipeline experts notes`; the ids `EX-<role>-<n>` are
  assigned there, in note order.
- Write the artifact outside the feature bundle (for example under `.paqad/tmp/`); the verb
  records it and `spec freeze` cleans up the inputs it was handed.

## Escalate / Stop Conditions

- Never write as a role you were not given, and never add a "general" finding with no concrete
  target.
- Never write a question in mechanism words when a business phrasing exists — the plain-language
  check refuses it and names the flagged terms.
- Never exceed the granted budget in the brief; stop and report the tokens you used.

## Resources

- `references/finding-kinds.md` — the finding shape and what each `kind` becomes in the spec.
- `references/lenses/` — one lens per pickable expert (read the one named by `role`).
- `assets/output.template.md` — the canonical output shape.
- `scripts/lint-output.sh` — validates the output shape before you hand it back.
- `runtime/base/skills/expert-notes/agents/openai.yaml` — agent interface metadata.
- `src/spec-pipeline/experts/notes.ts` — the deterministic guard that validates this output.
