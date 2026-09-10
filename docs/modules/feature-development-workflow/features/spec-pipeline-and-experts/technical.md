# Spec Pipeline & Experts (Technical)

> **Slug:** `spec-pipeline-and-experts` &nbsp;·&nbsp; **Issue:** #547

## The steps

The pipeline is a fixed step-machine. It runs in order and each step writes its own artifact:

| Step | What it does |
|---|---|
| `ground` | Fetches the ticket, writes the request text, grounds it in the project's own docs, records grounding sparsity and path. |
| `label` | Rates how clear the request is (the clarity label). |
| `experts` | Picks the experts this request needs, runs a lens per expert, then the chief architect synthesises. **Complete by skip** when the roster is off or no expert was named. |
| `questions` | Emits one batch of plain-language questions, only for what the docs cannot answer. Reuses a prior answer when the project already answered the same thing. |
| `task` | Assembles the settled inputs into the task the spec is written against. |
| `craft` | Writes `spec.md` in freeze format, every line traced to a source. |
| `finish` | Writes run provenance and metrics. |

## Artifacts

All under the git-ignored `.paqad/_specs/<feature>/pipeline/`:

| File | Contents |
|---|---|
| `grounding.json` | Grounding slices, sparsity, and path. |
| `label.json` | The clarity label. |
| `experts.json` | The need: which experts this request wants. |
| `briefs/<role>.md` | The brief handed to each picked expert. |
| `expert-notes.json` | Each expert's raw notes. |
| `expert-merge.json` | The merged view, with conflicts flagged. |
| `expert-synthesis.json` | The chief architect's accept/decline, conflict recommendations, gaps, and readiness verdict. |
| `questions.json` | The question batch and answers. |
| `task.json` | The assembled task. |
| `spec.md` | The freeze-format spec. |
| `trace.json` | Every requirement line mapped to its source. |
| `finish.json` | Run provenance and metrics. |
| `corrections.jsonl` | Section-level rows for later human edits to a frozen spec. |
| `log.jsonl` | Per-step token and event log. |

## Flags

| Flag | Effect |
|---|---|
| `spec_pipeline_enabled` | Master switch. Off, and the change is exactly as before. |
| `spec_pipeline_experts_enabled` | Gates the roster. Off, and the `experts` step completes by skip. |
| `spec_pipeline_clarification` | Gates the `questions` step. |
| `spec_pipeline_final_review` | Gates the chief architect's readiness pass. |
| `spec_pipeline_token_ceiling` | Per-run token budget. Overruns are recorded as ceiling warnings, not hard stops. |
| `spec_pipeline_adoption` | `warn` \| `strict`, default `warn`. Controls how strict the freeze is (see Freeze). |

## The expert roster and lenses

There is **one runner skill**, `expert-notes`, with a lens per pickable expert at `runtime/base/skills/expert-notes/references/lenses/<role>.md`, and **one chief skill**, `expert-synthesis`.

The eleven pickable experts:

`db-expert`, `data-modeler`, `security-auditor`, `ux-ui-analyst`, `user-flow-writer`, `performance-analyst`, `integration-architect`, `solution-architect`, `devops-engineer`, `qa-engineer`, `market-researcher`.

The `chief-architect` is never picked; it runs once any expert fired. The model decides which experts a request needs. The script only validates the picks against the roster.

## Gates

- **Craft trace gate.** The `craft` step refuses an untraced requirement line, and refuses an accepted expert finding that reached neither the spec nor the declined list. Nothing an expert accepted can quietly disappear.
- **Conflict packets.** Each merge conflict becomes exactly one `spec.expert_conflict` decision packet, minted through the sanctioned writer, reusing an identical resolved fork rather than re-asking a settled question.
- **Question lock.** The `questions` step is locked while a conflict packet is pending, so you never answer questions built on an unsettled disagreement.

## Freeze

`paqad-ai spec freeze <spec.md> --from-pipeline` copies the run provenance into `specification.json`.

- Under **strict** adoption, a non-pipeline spec is refused unless `--manual --reason` is given.
- The readable `specification.md` renders a `## Provenance` section only when provenance is present.
- The completeness gate **fails closed** under strict adoption for a non-pipeline spec with no manual reason.

## Metrics

`finish.json.provenance.metrics` records grounding sparsity and path, the clarity label, question counts, spec size, tokens per step and per expert, ceiling warnings, and which freeze checks would fire.

`changed_spec` is true only when an expert finding id appears as a trace source, so an expert only counts as having changed the spec when a line actually cites it. A human's later edit to a frozen spec appends a section-level row to `corrections.jsonl`. `paqad-ai spec pipeline metrics [--all]` aggregates all of this, zero model tokens.

## Determinism

paqad calls no model from Node. Every deterministic step is model-free: the roster check, brief sizing, merge, id assignment, synthesis validation, packet minting, trace gate, and metrics. The model is consulted only inside the skills; the scripts around them decide nothing that a rerun could change.
