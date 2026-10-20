# Spec Pipeline & Experts (Technical)

> **Slug:** `spec-pipeline-and-experts`

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

The pipeline writes straight into the change's evidence bundle. There is no separate scratch folder. Each fact lands in the bundle the moment the verb that owns it runs:

| Bundle file | Written by | Contents |
|---|---|---|
| `request.md` | `start` | The request text, with the bundle header in YAML front matter. |
| `clarification.json` | `start` (label), `record questions` | A `label` section (value, signals, question budget) and a `questions` section (asked, auto-answered, deferred, counts). |
| `experts.json` | `experts record`, `experts notes`, `experts synthesis` | A `roster` section (role, reason, lens, budget, `brief_hash`, tokens used), a `findings` section holding each `EX-*` finding once, and a `synthesis` section that refers to findings by id only. |
| `high-table.jsonl` | `experts record`, `experts brief`, `experts context`, `experts notes`, `experts synthesis`, the SubagentStop hook | One row per High Table event (`seated`, `writing`, `done`, `usage`), see [The High Table](#the-high-table-issue-639-part-13). Optional: a change that never seats the table has none. |
| `stage-evidence.jsonl` | every step | One `kind: "spec-step"` row per step (`step`, `outcome`, `artifact_hash`, optional tokens). A redo appends a row with outcome `redone`. A later edit to a frozen spec appends a `kind: "spec-correction"` row. |

The facts that only belong in `specification.json` (the task, the grounding, the trace, the finish outcome, and the working `spec.md`) stage under `.paqad/tmp/spec-pipeline/<ULID>/` until the freeze. The staging dir is keyed by the change ULID, so a bundle rename leaves nothing behind.

Expert briefs are never stored. `paqad-ai spec pipeline experts brief <role>` prints a brief rebuilt from `request.md`, the grounding, the clarity label and the roster entry, and refuses when its hash no longer matches the roster's `brief_hash`. `paqad-ai spec pipeline experts context` prints what the need detector and the chief architect read, with the expert merge recomputed in memory.

## Flags

| Flag | Effect |
|---|---|
| `spec_pipeline_enabled` | Master switch, default `true`. Set `false`, and the change is exactly as before. |
| `spec_pipeline_experts_enabled` | Gates the roster, default `true`. Set `false`, and the `experts` step completes by skip. |
| `spec_pipeline_clarification` | Gates the `questions` step. |
| `spec_pipeline_final_review` | Gates the chief architect's readiness pass. |
| `spec_pipeline_token_ceiling` | Per-run token budget, default 40000. Overruns are recorded as ceiling warnings, not hard stops. |
| `spec_pipeline_adoption` | `warn` \| `strict`, default `strict`. Controls how strict the freeze is (see Freeze). |

The three defaults live in one place, `SPEC_PIPELINE_DEFAULTS` in `src/core/framework-config.ts`. `readPipelineConfig`, `readSpecPipelineFlags` and the prompt-gate nudge (`runtime/hooks/lib/agent-entry-directive.mjs`, which mirrors the values and is guarded by a drift test) all read an unset key as that default. A value set in any layer wins, in the usual order: `PAQAD_*` env, then `.paqad/.config`, then `.paqad/configs/.config.*`. `paqad-ai update` never writes a default into a config file.

The defaults apply only on the graduated and full lanes. The fast lane never runs the pipeline: the prompt gate prints no nudge there, `spec freeze` treats a fast-lane change as if the pipeline were off, and the completeness gate does not ask for `request.md`, `clarification.json` or `experts.json` (see `laneRunsSpecPipeline` in `src/feature-evidence/manifest.ts`; an unresolved lane counts as full). `paqad-ai doctor` shows each switch, where its value came from, and the standing experts' budget (about 24k tokens per spec against the 40k ceiling).

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

- Under **strict** adoption (the default), a non-pipeline spec is refused unless `--manual --reason` is given. A fast-lane change is never refused: it freezes without the pipeline, and its `pipeline` section records `skipped: "fast-lane"`. If the lane is later raised to graduated or full, the pipeline files are owed again and the completeness gate asks for a re-freeze through the spec pipeline.
- There is no `specification.md`. The feature report renders the spec from `specification.json`.
- The completeness gate **fails closed** under strict adoption for a non-pipeline spec with no manual reason, on the graduated and full lanes.

## Metrics

`paqad-ai spec pipeline metrics` works the run's numbers out from the bundle: grounding sparsity and path, the clarity label, question counts, spec size, tokens per step and per expert, ceiling warnings, and which freeze checks would fire. It reads the `specification.json` `pipeline` section (or the staged finish before freeze), `clarification.json`, `experts.json` and the `spec-step` rows.

`changed_spec` is true only when an expert finding id appears as a trace source, so an expert only counts as having changed the spec when a line actually cites it. A human's later edit to a frozen spec appends a section-level `spec-correction` row. `paqad-ai spec pipeline metrics --all` lists every feature bundle and adds it all up, zero model tokens.

## Determinism

paqad calls no model from Node. Every deterministic step is model-free: the roster check, brief sizing, merge, id assignment, synthesis validation, packet minting, trace gate, and metrics. The model is consulted only inside the skills; the scripts around them decide nothing that a rerun could change.

## Standing experts and the project voice

The roster is thirteen pickable roles. Four are **standing** and seated by the script on every run whatever the detector returned: `product-owner`, `application-architect`, `user-flow-writer`, `qa-engineer`. The other nine are **on call** and picked by the detector as before. `application-architect` is a new role (`AGENT_ROLES`, budget 8000), separate from `solution-architect`: the application architect owns "which framework piece each part becomes and where it lives", the solution architect owns reuse and consumers. The standing set is configurable through `spec_pipeline_standing_experts` (comma-separated role ids; empty means none; an unknown id is dropped with a doctor warning). The onboarded token ceiling default rose to 40000 so the four standing budgets are not clamped.

Grounding now extracts a structured `vocabulary` (`VocabularyEntry[]`) from the touched modules' `business.md` (glossary, roles, flows, business rules), their `technical.md` (database, API, config, module-boundary names), and `.paqad/glossary.md`. Every expert brief renders a `## Project voice` section (a pure `renderProjectVoice`): the stack line, the stack-pack guide pointers, the architecture and stack pages, the touched technical pages, and the business words. `termsFromMarkdown` drops scaffold headings and malformed bold spans.

A deterministic voice check (`checkFindingVoice`) flags a finding target the project does not name (allowing documented words, request words, existing paths, indexed symbols, and `new `/`this request` targets), recording a `voice_warnings` row with a hint. It never refuses a note. The chief settles each warning through `renames: [{ id, target }]` on the synthesis, applied to the merged findings (the original kept as `renamed_from`) before the craft step reads them.

The frozen `specification.json` pipeline section keeps a `findings` snapshot of every accepted finding (after renames) plus an `experts` summary (`standing`, `on_call`, `renamed`), and the grounding section persists the `vocabulary` so a brief rebuilds with the same hash. The feature report renders a "Who contributed what" table from the trace and the snapshot. `paqad-ai spec pipeline metrics` reports each expert's `tier`, `empty rate` and `voice warnings` next to its `changed_spec` rate, and prints the demotion footer.

## The High Table

The experts and the chief architect sit at the High Table. Each seated expert can run as its own host subagent, `paqad-expert`, with its role given in the prompt, and the chief runs as `paqad-chief-architect`. Several seats can then write at once. Both agents are read-only: each writes one artifact under `.paqad/tmp/` and hands it to a `paqad-ai spec pipeline experts` verb. Install and update write them at user scope beside the six stage agents, but they are never stages: only the six `paqad-<stage>` agents add a `stage-agent` row or count as an isolated stage (`stageForAgentName` in `src/stage-isolation/stage-agents.ts`).

`experts.json` is rewritten whole, so it cannot say when a seat started or finished. `high-table.jsonl` does, with one stamped row per event (`src/spec-pipeline/high-table.ts`):

- **`seated`**, one per seat at `experts record`: role, reason, origin, the budget granted after the token ceiling and whether the ceiling clamped it. The chief gets a seat with its fixed 10000-token budget.
- **`writing`**, when a seat starts: `experts brief <role>` for an expert, `experts context` for the chief once the notes are in.
- **`done`**, when a seat's work lands: `experts notes` for each role in the artifact, `experts synthesis` for the chief. It carries the seat's self-reported tokens, labelled an estimate.
- **`usage`**, written by the existing SubagentStop hook for a High Table agent: the exact tokens by kind and model, read from that subagent's own transcript. With no readable transcript no `usage` row is written and the seat keeps its estimate.

A row that fails to write is reported on stderr and never changes the verb's result. Nothing here edits `experts.json`; the HUD folds both files into the live table.

**Notes merge one role at a time.** `experts notes` replaces only the roles its artifact names (their findings, voice warnings, staged questions and reported tokens) and keeps every other role as it was. The whole read and write of `experts.json` and the staged questions runs under a file lock, so two seats that finish at the same moment never lose a note.

**A table that met late.** When any `done` row lands after the spec was frozen, the HUD table carries `met_after_freeze: true`, raises the flag "The High Table met after the spec was frozen, so it shaped no spec line." and credits the table with no spec line. A spec frozen by hand while the pipeline was on shows the table as skipped. The fast lane has no High Table.

## Why the code works the way it does

The reasons below are not obvious from the code, grouped by file in `src/spec-pipeline/`.

- **`auto-answer.ts`.** The function is synchronous on purpose: a sync function cannot make a model call. Two ledger seams are tried in order: exact fingerprint reuse through `findIntakePriorMatch`, then a textual precedent from `findDecisionPrecedents`, accepted only at a high score floor. `scorePrecedent` gives 0.5 for the same category plus up to 0.5 for word overlap, so the floor admits only same-category questions with strong overlap. The compiled-rule seam is deliberately not used: it is triggered by file globs and cannot choose among plain-language options.
- **`config.ts`.** A hand-trimmed value falls back to the documented default instead of throwing. The three switches share one resolver with `readSpecPipelineFlags`, so both readers take the same default for an unset key. `expertsActive` is the one place that checks "pipeline on and experts on", so an experts flag set while the pipeline is off never runs expert code.
- **`experts/accounting.ts` and `experts/assemble.ts`.** `changed_spec` is true only when one of the expert's finding ids appears as a trace source; before the craft step there is no trace, so no expert has changed the spec yet. When no need artifact was recorded, or it is invalid, no expert block is written, so a run with the experts off is byte-identical to one from before the roster existed.
- **`experts/brief.ts`.** Grounding references are trimmed to the granted budget at four characters per token, longest pointers dropped first, so the most pointers survive. The same renderer feeds both `experts record` (which hashes it) and `experts brief` (which prints it), and every input is recorded, so a rebuild gives the same text and hash.
- **`experts/conflicts.ts` and `experts/merge.ts`.** The merge never picks a winner: a target with two or more distinct claims becomes a conflict and none of its findings enter the merged set. Targets and claims compare case- and whitespace-insensitively. A fork's identity is its target plus its claim set, order independent, embedded as a token in the packet context so a later run recognises it; the earliest resolution of a fork is the one reused. A hand-built finding with no id keeps an empty string so the id arrays stay index-aligned.
- **`experts/need.ts` and `experts/roster.ts`.** The model decides which experts a request needs because a script cannot tell reliably; the script only checks the artifact is well formed and names nothing outside the roster. The roster is derived from `AGENT_ROLES` and budgets from `ROLE_TOKEN_BUDGETS`, never a second copy. An unknown role throws instead of getting a default budget, because a silent fallback would hide a caller bug. A need artifact naming `chief-architect` gets its own refusal message before the generic one.
- **`experts/notes.ts`.** The voice check never refuses a note; it only records a warning with the closest business and technical word.
- **`experts/slice.ts`.** Over the ceiling, every expert is kept and slices scale down with a warning; a tiny ceiling still grants at least one token per expert.
- **`finish.ts`.** An automatic freeze is allowed only when the spec-vs-code check is live (a code-knowledge index exists); otherwise the spec is shown as a non-blocking review. Provenance carries human input by reference only and never claims an approval that did not happen. The experts key is left off entirely when experts did not run.
- **`grounding.ts`.** Both paths run the same extraction over the same file bodies, so they give the same output for the same content. The RAG path is trusted only when it produced vocabulary; otherwise it falls back to the docs so a cold index still grounds. The retrieval call passes an explicit `topN` so the depth gate never skips it. The pipeline owns no retrieval cache or reader of its own.
- **`labeling.ts` and `plain-language.ts`.** The clarity label is a deterministic function of the prompt and the grounding, never the model's self-assessment; a vague word the docs define does not count as vague. The jargon list is only a backstop: a technical-looking token is flagged only when it does not appear in the project sources, so a documented table name is allowed. Tokens are split on whitespace so `foo_bar`, `/api/x` and `GET` survive intact.
- **`orchestrator.ts`.** The questions step-lock accepts a raw agent batch with only `questions[]`; the enriched fields are validated only when present. The step-lock check on the synthesis is light; the full validation runs in the `experts synthesis` verb. A clear label skips questions only when no expert or chief question is waiting. The enforcement config is stored once with the frozen spec, never on each step row.
- **`parser-parity.ts`.** The craft shape check runs the real freeze parser instead of a parallel one, and a shared corpus is run against both in CI, so the two cannot drift. Dotted acceptance-criterion ids are rejected because the flat freeze parser mangles them.
- **`run-store.ts`.** The staging dir and the expert-notes lock are keyed by the change ULID, not the folder name, so a bundle rename splits nothing; the lock lives under `.paqad/locks/`, never in the bundle. Findings are ordered by the roster's seat order so parallel seats land the same way. Only inputs under `.paqad/tmp/` are remembered for deletion; paths elsewhere are the user's own files. Both spellings of the project root (as given and with symlinks resolved) are checked. The vocabulary is persisted at freeze so the brief hash is reproducible after staging is gone.
- **`trace.ts`.** Stable ids carry forward only on an exact `kind` and `source` match, never fuzzy content; a retired id is never reused. That exactness is what lets the spec-vs-code check follow a requirement over time.
