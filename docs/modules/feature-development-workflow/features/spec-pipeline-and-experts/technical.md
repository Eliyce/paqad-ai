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
| `finish` | Records the run outcome, ready for the freeze to merge into `specification.json`. |

## Where the run lives

The pipeline writes straight into the change's evidence bundle (issue #581). There is no separate scratch folder. Each fact lands in the bundle the moment the verb that owns it runs:

| Bundle file | Written by | Contents |
|---|---|---|
| `request.md` | `start` | The request text, with the bundle header in YAML front matter. |
| `clarification.json` | `start` (label), `record questions` | A `label` section (value, signals, question budget) and a `questions` section (asked, auto-answered, deferred, counts). |
| `experts.json` | `experts record`, `experts notes`, `experts synthesis` | A `roster` section (role, reason, lens, budget, `brief_hash`, tokens used), a `findings` section holding each `EX-*` finding once, and a `synthesis` section that refers to findings by id only. |
| `stage-evidence.jsonl` | every step | One `kind: "spec-step"` row per step (`step`, `outcome`, `artifact_hash`, optional tokens). A redo appends a row with outcome `redone`. A later edit to a frozen spec appends a `kind: "spec-correction"` row. |

The facts that only belong in `specification.json` (the task, the grounding, the trace, the finish outcome, and the working `spec.md`) stage under `.paqad/tmp/spec-pipeline/<ULID>/` until the freeze. The staging dir is keyed by the change ULID, so a bundle rename leaves nothing behind.

Expert briefs are never stored. `paqad-ai spec pipeline experts brief <role>` prints a brief rebuilt from `request.md`, the grounding, the clarity label and the roster entry, and refuses when its hash no longer matches the roster's `brief_hash`. `paqad-ai spec pipeline experts context` prints what the need detector and the chief architect read, with the expert merge recomputed in memory.

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

`paqad-ai spec freeze <spec.md> --from-pipeline` merges the staged run into `specification.json`: a `task` section, a `grounding` section, a `pipeline` section (`produced`, `outcome`, `reason`, `a5_live`, the enforcement block once, and `manual_reason` for a manual freeze) and a `trace` map keyed by item id. It copies the signed source into the bundle as `spec.md`, then deletes the staging dir and every `.paqad/tmp/` input the record verbs were handed.

- Under **strict** adoption, a non-pipeline spec is refused unless `--manual --reason` is given.
- There is no `specification.md`. The feature report renders the spec from `specification.json`.
- The completeness gate **fails closed** under strict adoption for a non-pipeline spec with no manual reason.

## Metrics

`paqad-ai spec pipeline metrics` works the run's numbers out from the bundle: grounding sparsity and path, the clarity label, question counts, spec size, tokens per step and per expert, ceiling warnings, and which freeze checks would fire. It reads the `specification.json` `pipeline` section (or the staged finish before freeze), `clarification.json`, `experts.json` and the `spec-step` rows.

`changed_spec` is true only when an expert finding id appears as a trace source, so an expert only counts as having changed the spec when a line actually cites it. A human's later edit to a frozen spec appends a section-level `spec-correction` row. `paqad-ai spec pipeline metrics --all` lists every feature bundle and adds it all up, zero model tokens.

## Determinism

paqad calls no model from Node. Every deterministic step is model-free: the roster check, brief sizing, merge, id assignment, synthesis validation, packet minting, trace gate, and metrics. The model is consulted only inside the skills; the scripts around them decide nothing that a rerun could change.
