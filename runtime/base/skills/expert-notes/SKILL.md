---
name: expert-notes
description: >-
  Reads one expert's brief and, through that expert's lens, writes short request-time notes for the spec pipeline: what the request must do, must never break, and still leaves undecided, as findings plus plain-language questions. One runner skill with a lens per expert (db, security, ui, qa-engineer, agent-orchestrator and the rest), so the procedure is shared and only the lens differs; the qa-engineer note also carries the spec compliance and quality verdicts. The pipeline script validates the output against the roster and never decides. Use when the spec pipeline runs with the expert roster on and an expert on the roster, or a High Table seat given one role, needs its note, findings, questions or verdicts written from its brief (phase 2 of the spec pipeline; the TS guard is src/spec-pipeline/experts/notes.ts).
metadata:
  model_tier: reasoning
  cacheable: 'false'
  output_format: json
  paqad-meta: skill.meta.yaml
---

## What It Does

Writes ONE expert's request-time notes from its brief: the requirements the request implies, the
invariants it must never break, the acceptance behaviour it should show, the risks it carries,
and the questions only a human can answer. Each expert is a **lens** over this one procedure (the
db-expert looks for tables, indexes and migration safety, the security-auditor for who may act),
and the lens is the only thing that changes. It decides from the **brief alone**, never the whole
repo; the pipeline script validates, numbers and merges what comes back.

## Use This When

- The spec pipeline is running with the expert roster on (`spec_pipeline_experts_enabled`), the
  `expert-need-detector` has named the experts, and `experts record` has put them on the roster.
  Run this skill once per expert, with the brief the `experts brief` verb prints for it.
- You run as one High Table seat (a `paqad-expert` subagent) given one role. Then a
  note covers that role only: write one note, hand it to `experts notes`, and the verb merges it
  beside the other seats' notes without touching them.

Do **not** run this when the experts flag is off; the skill never runs then. Do **not** invent a role: you write as the role in the brief.

## Inputs

- `role`: required. The expert role you are writing as; apply its lens.
- `brief`: required. Print it with `paqad-ai spec pipeline experts brief <role>`; it is never a
  file. It carries the request, the ticket acceptance criteria when present, the grounding
  pointers (never file bodies), the clarity label, the Project voice and your token budget.

## Procedure

1. Print your brief with `paqad-ai spec pipeline experts brief <role>`. Read your lens, the file
   named for your role in the lens list under Resources. The lens is the only file you need: kinds,
   severities and the output shape are on this page, and each extra read costs budget.
2. Decide from the request and the grounding **only**. Do not read the whole repo.
3. Write findings about concrete targets (a table, an endpoint, a screen, a journey step), each
   about ONE target and making ONE claim. Mark each finding's `kind` (`requirement` becomes an
   FR or NFR, `invariant` an INV, `acceptance` an AC, `risk` an NFR or failure-path AC,
   `non-goal` a Non-goals line) and `severity` (`must`: the spec is wrong without it; `should`:
   strongly expected; `could`: safe to defer). `references/finding-kinds.md` has the longer
   version. Name every target in the project's words: see the Project voice section of your
   brief.
4. Phrase every question as a `PipelineQuestion`
   (`{ business_text, why_it_matters, options, grounded_in }`): business words, options phrased
   as outcomes, and the grounding reference it is grounded in (or `null`). Ask only what the
   project's own docs cannot answer.
5. Report the tokens you spent. Stop when the budget in the brief is reached. Findings may be
   empty (you looked and had nothing to add: a valid, cheap outcome).
6. Validate the file with `scripts/lint-output.sh`, then hand it to the pipeline:
   `paqad-ai spec pipeline experts notes <file>`. That runs the deterministic guard
   (`src/spec-pipeline/experts/notes.ts`): an unknown role, kind or severity, or a question in
   jargon, is refused there; do not re-implement that check. The verb stores each finding once in
   the change's `experts.json` and your tokens on your roster entry; never write that file
   yourself.

## Output Contract

- One JSON object, shaped like `assets/output.template.md`:
  `{ "notes": [ { "role", "findings": [ { "target", "claim", "kind", "severity", "evidence"? } ], "questions": [ PipelineQuestion ] } ], "tokens": { "<role>": n } }`.
- `findings` and `questions` may be empty. One note per brief; as a High Table seat that is one
  note, for your role. `evidence` is an optional grounding reference.
- The `qa-engineer` note also carries `"verdicts": { "spec_compliance": { "status", "reason" },
"quality": { "status", "reason" } }`, each status `pass | concerns | fail`: one verdict on
  whether the spec meets the request, one on whether it is testable and complete. No other role
  carries verdicts.
- `paqad-ai spec pipeline experts notes` validates it and assigns the ids `EX-<role>-<n>` in
  note order. Write the artifact outside the feature bundle (for example under `.paqad/tmp/`).

## Escalate / Stop Conditions

- Never write as a role you were not given, and never add a "general" finding with no concrete
  target.
- Never write a question in mechanism words when a business phrasing exists: the plain-language
  check refuses it and names the flagged terms.
- Never exceed the granted budget in the brief; stop and report the tokens you used.

## Resources

- `references/finding-kinds.md`: the finding shape and what each `kind` becomes in the spec.
- `assets/output.template.md`: the canonical output shape.
- `scripts/lint-output.sh`: validates the output shape before you hand it back.
- `runtime/base/skills/expert-notes/agents/openai.yaml`: agent interface metadata.
- `src/spec-pipeline/experts/notes.ts`: the deterministic guard that validates this output.

Lenses, one per pickable expert; read only the one named by `role`:

- `references/lenses/agent-orchestrator.md`
- `references/lenses/application-architect.md`
- `references/lenses/data-modeler.md`
- `references/lenses/db-expert.md`
- `references/lenses/devops-engineer.md`
- `references/lenses/integration-architect.md`
- `references/lenses/market-researcher.md`
- `references/lenses/performance-analyst.md`
- `references/lenses/product-owner.md`
- `references/lenses/qa-engineer.md`
- `references/lenses/security-auditor.md`
- `references/lenses/skill-orchestrator.md`
- `references/lenses/solution-architect.md`
- `references/lenses/user-flow-writer.md`
- `references/lenses/ux-ui-analyst.md`
