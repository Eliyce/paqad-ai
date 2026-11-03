# paqad team configuration (`.paqad/configs/`)

Tracked, team-shared settings, in small YAML files that hold only what this team
changed. A setting that isn't in a file uses paqad's default.

- `paqad.yaml` — The package itself: on/off, updates, Claude Code install, HUD and Site Map.
- `models.yaml` — Which models paqad uses and how deep research goes.
- `retrieval.yaml` — How paqad finds relevant code and docs (RAG).
- `decisions.yaml` — When paqad stops to ask you, in any workflow.
- `authoring.yaml` — How paqad writes and tests skills and helper agents, and its eval runs.
- `feature-development/workflow.yaml` — Lanes, stage helpers, stage tracking, and per stage: effort, model, extra reads and instructions.
- `feature-development/specification.yaml` — The spec pipeline, its questions, the final review and the experts.
- `feature-development/rules.yaml` — How project rules are loaded and enforced.
- `feature-development/reuse.yaml` — The existing-code digest, the duplication gate and the create-vs-reuse pause.
- `feature-development/safety.yaml` — Destructive operations, risky migrations, security findings and database review.
- `feature-development/checks.yaml` — What the checks stage runs and how: commands, parallel runs, flaky tests, mutation testing.
- `feature-development/evidence.yaml` — The proof a change leaves: bundle, report, metrics, screenshots and enterprise outputs.
- `feature-development/analytics.yaml` — Analytics instrumentation (opt-in).
- `git-workflow/` — the team rules for tickets, branches, commits, pull requests and
  enforcement (see below).
- `schemas/` — JSON schemas for your editor, written by paqad and git-ignored.

Run `paqad-ai config show` to see every setting, its value and where it comes from
(`--changed` lists only the ones that differ from the default).

## How to use

- Add a setting at its path to change it; delete the line to go back to the default.
- Each file starts with a `# yaml-language-server` line, so VS Code (with the Red Hat
  YAML extension) and JetBrains IDEs offer every setting with its description,
  default and allowed values.
- Gates use one vocabulary: `off | warn | block`.
- `paqad-ai update` never changes a value you set. It regenerates the schemas and this
  README, and creates any missing file with only its header.

## Personal overrides

A teammate can override a setting for themselves in the git-ignored `../.config`
(`<name>=<value>`, using the `.paqad/.config` name below), and a `PAQAD_*` env var
overrides everything. Both accept the values below as well as the older values.
`../.config.example` lists every name with its YAML home.

## Every setting

### `paqad.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `enabled` | `true` | true \| false | Turn paqad off entirely (vanilla mode). Absent/true = on. | `paqad_enable` | `PAQAD_ENABLE` |
| `team_bootstrap.enabled` | `true` | true \| false | Let teammates and Claude Code cloud sessions set paqad up from this repo on their own. false = onboarding writes no team setup and the launcher does nothing. | `team_bootstrap_enabled` | `PAQAD_TEAM_BOOTSTRAP_ENABLED` |
| `updates.automatic` | `true` | true \| false | Pull newer framework versions in the background on session start. | `auto_update` | `PAQAD_AUTO_UPDATE` |
| `updates.minimum_version` | `latest` | text | Refuse to run below this version. "latest" = no fixed floor, track newest. Or pin e.g. 1.28.1. | `minimum_version` | `PAQAD_MINIMUM_VERSION` |
| `updates.check_every_hours` | `12` | a number | How often the background version check runs. | `version_check_interval_hours` | `PAQAD_VERSION_CHECK_INTERVAL_HOURS` |
| `site_map.enabled` | `false` | true \| false | Opt in to the Site Map & Journeys capability — a verified behavioural map of the app stored at docs/site-map/ (the Site map dashboard area + `site-map` workflow). OFF (default) is completely inert; ON also requires the coding capability at its consumers. | `site_map` | `PAQAD_SITE_MAP` |
| `hud.band` | `true` | true \| false | Show the paqad HUD band above the prompt in the Claude Code plugin. OFF shows no band and registers no /paqad command. | `hud_view` | `PAQAD_HUD_VIEW` |
| `hud.chime` | `false` | true \| false | Play a short chime in the Claude Code plugin when the verdict lands, once per verdict. A chime only, never speech. | `hud_chime` | `PAQAD_HUD_CHIME` |
| `claude_code.plugin_migration` | `off` | on \| off | on \| off — fleet-wide switch to move existing npm Claude Code users to the paqad plugin automatically in the background. Default off until manual sign-off; Claude Code only, npm is never removed and stays the fallback. | `plugin_migration` | `PAQAD_PLUGIN_MIGRATION` |
| `claude_code.install_mode` | `auto` | auto \| plugin \| settings | auto \| plugin \| settings — per-project override of the plugin migration. settings never migrates (stay on npm hooks); set in a tracked configs file it also keeps the plugin out of the shared .claude/settings.json. plugin forces the migration even while plugin_migration is off; auto follows plugin_migration. | `claude_install_mode` | `PAQAD_CLAUDE_INSTALL_MODE` |

### `models.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `research.depth` | `standard` | cutting-edge \| standard \| conservative | cutting-edge \| standard \| conservative. | `research_depth` | `PAQAD_RESEARCH_DEPTH` |
| `models.default` | `gpt-5` | text | Default model for routine work. | `model_default` | `PAQAD_MODEL_DEFAULT` |
| `models.reasoning` | `gpt-5` | text | Model for heavy reasoning / planning. | `model_reasoning` | `PAQAD_MODEL_REASONING` |
| `models.fast` | `gpt-5-mini` | text | Cheap/fast model for lightweight steps. | `model_fast` | `PAQAD_MODEL_FAST` |

### `retrieval.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `enabled` | `false` | true \| false | Enable retrieval-augmented context loading. | `rag_enabled` | `PAQAD_RAG_ENABLED` |
| `embeddings.provider` | `(unset)` | local \| openai | local \| openai. Unset uses the local model. | `rag_embedding_provider` | `PAQAD_RAG_EMBEDDING_PROVIDER` |
| `embeddings.model` | `(unset)` | text | Override the embedding model id. Unset = provider default. | `rag_embedding_model` | `PAQAD_RAG_EMBEDDING_MODEL` |
| `match.min_similarity` | `0.75` | a number | Minimum cosine similarity for a chunk to be retrieved. | `rag_similarity_threshold` | `PAQAD_RAG_SIMILARITY_THRESHOLD` |
| `match.fallback_min_similarity` | `0.35` | a number | Relief band for floor-with-relief. When nothing clears rag_similarity_threshold, the top slices at or above this lower score are delivered tagged low-confidence. | `rag_relief_floor` | `PAQAD_RAG_RELIEF_FLOOR` |
| `match.max_results` | `20` | a number | Max chunks retrieved per query. | `rag_top_n` | `PAQAD_RAG_TOP_N` |
| `index.max_file_size_bytes` | `153600` | a number | Skip indexing files larger than this many bytes. | `rag_max_file_size` | `PAQAD_RAG_MAX_FILE_SIZE` |
| `index.base_branch` | `(unset)` | text | Base branch for branch-aware RAG. Unset auto-detects main->master. | `rag_base_branch` | `PAQAD_RAG_BASE_BRANCH` |

### `decisions.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `ask` | `often` | often \| balanced \| rarely | strict \| balanced \| permissive — how eagerly to pause and ask. | `decisions_ask_threshold` | `PAQAD_DECISIONS_ASK_THRESHOLD` |
| `max_screens_per_change` | `3` | a number | Max decision screens surfaced per task. | `decisions_max_screens_per_task` | `PAQAD_DECISIONS_MAX_SCREENS_PER_TASK` |
| `auto_resolve_after_minutes` | `30` | a number | Auto-resolve a pending decision after this idle window. | `decisions_idle_timeout_minutes` | `PAQAD_DECISIONS_IDLE_TIMEOUT_MINUTES` |

### `authoring.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `skills.enabled` | `true` | true \| false | Turn the Skill Orchestrator on or off. Off means no High Table seat on skill paths, no skill pipeline, no lane raise for skills and no skill completion check, so a skill edit is judged as before. | `skill_orchestrator_enabled` | `PAQAD_SKILL_ORCHESTRATOR_ENABLED` |
| `skills.trigger_threshold` | `0.9` | a number | S6 trigger test: the validation pass rate a skill description needs, from 0 to 1. | `authoring_trigger_threshold` | `PAQAD_AUTHORING_TRIGGER_THRESHOLD` |
| `skills.trigger_min_runs` | `2` | a number | S6 trigger test: how many of the 3 runs of each query must fire the skill. A positive whole number. | `authoring_trigger_min_runs` | `PAQAD_AUTHORING_TRIGGER_MIN_RUNS` |
| `skills.eval_min_gain_points` | `10` | a number | S5 evals: the pass-rate gain over the no-skill baseline a skill needs, in percentage points. A positive whole number. | `skill_eval_min_gain_points` | `PAQAD_SKILL_EVAL_MIN_GAIN_POINTS` |
| `skills.eval_max_token_multiple` | `2` | a number | S5 evals: the most median tokens a skill run may use, as a multiple of the baseline. 1 or more. | `skill_eval_max_token_multiple` | `PAQAD_SKILL_EVAL_MAX_TOKEN_MULTIPLE` |
| `runs.per_arm` | `3` | a number | S5 evals: runs per arm (with and without the skill) for each case. A positive whole number. | `authoring_runs_per_arm` | `PAQAD_AUTHORING_RUNS_PER_ARM` |
| `runs.max_iterations` | `3` | a number | S5 evals: the most revision rounds before the loop stops. A positive whole number. | `authoring_max_iterations` | `PAQAD_AUTHORING_MAX_ITERATIONS` |
| `skills.fact_max_age_days` | `60` | a number | Days an externally verified fact in sources.md stays fresh. Older facts block release until rechecked. A positive whole number. | `authoring_fact_max_age_days` | `PAQAD_AUTHORING_FACT_MAX_AGE_DAYS` |
| `skills.collision_jaccard` | `0.4` | a number | Overlap check: the word-set similarity (Jaccard, 0 to 1) at which a new skill collides with an installed one. | `authoring_collision_jaccard` | `PAQAD_AUTHORING_COLLISION_JACCARD` |
| `skills.description_budget_chars` | `8000` | a number | Overlap check: the total characters of every installed skill description before a release warns that some may be dropped. A positive whole number. | `authoring_description_budget_chars` | `PAQAD_AUTHORING_DESCRIPTION_BUDGET_CHARS` |
| `skills.body_max_tokens` | `5000` | a number | Lint (SK-008): the most tokens a SKILL.md body may hold. A positive whole number. | `skill_body_max_tokens` | `PAQAD_SKILL_BODY_MAX_TOKENS` |
| `runs.tool_result_max_tokens` | `10000` | a number | S5 analyst: a tool result above this many tokens is flagged as oversize. A positive whole number. | `authoring_tool_result_max_tokens` | `PAQAD_AUTHORING_TOOL_RESULT_MAX_TOKENS` |
| `runs.cache_hit_min` | `0.7` | a number | S5 analyst: the steady-state cache-hit share (0 to 1) below which a run is recorded as a performance defect. | `authoring_cache_hit_min` | `PAQAD_AUTHORING_CACHE_HIT_MIN` |
| `skills.regression_tolerance` | `0.2` | a number | S5 in improve mode and S8: how far (0 to 1) the pass rate of an edited or re-evaluated skill may fall below the old version before it fails. | `authoring_regression_tolerance` | `PAQAD_AUTHORING_REGRESSION_TOLERANCE` |
| `skills.dark_window_days` | `30` | a number | S8 catalog: days without a firing before a skill is reported as dark. A positive whole number. | `authoring_dark_window_days` | `PAQAD_AUTHORING_DARK_WINDOW_DAYS` |
| `runs.batch` | `auto` | auto \| off | auto \| off. auto lets S6 send its trigger queries as one batch when the host offers it; off always runs them one by one. | `authoring_batch_mode` | `PAQAD_AUTHORING_BATCH_MODE` |
| `runs.max_cost_usd` | `5` | a number | Spend cap in US dollars for one eval or trigger sweep, passed as --max-cost-usd. A capped run counts as a failure and is recorded as partial. Above 0. | `authoring_run_max_cost_usd` | `PAQAD_AUTHORING_RUN_MAX_COST_USD` |
| `runs.otel_endpoint` | `` | text | Empty reads usage numbers from the host only. An http(s) URL also reads them from that OpenTelemetry endpoint. paqad never sends transcripts to it. | `authoring_otel_endpoint` | `PAQAD_AUTHORING_OTEL_ENDPOINT` |
| `agents.enabled` | `true` | true \| false | Turn the Agent Orchestrator on or off. Off means no High Table seat on agent paths, no agent pipeline, no lane raise for agents and no agent completion check, so an agent edit is judged as before. | `agent_orchestrator_enabled` | `PAQAD_AGENT_ORCHESTRATOR_ENABLED` |
| `agents.pass_k_threshold` | `0.9` | a number | S5 agent evals: the pass^3 score (0 to 1) an agent needs on its task cases. | `agent_pass_k_threshold` | `PAQAD_AGENT_PASS_K_THRESHOLD` |
| `agents.stage_pass_k_threshold` | `0.95` | a number | S5 agent evals: the pass^3 score (0 to 1) an unattended stage agent needs on its task cases. | `agent_stage_pass_k_threshold` | `PAQAD_AGENT_STAGE_PASS_K_THRESHOLD` |
| `agents.delegation_threshold` | `0.9` | a number | S6 delegation test: the validation pass rate (0 to 1) an agent description needs. | `agent_delegation_threshold` | `PAQAD_AGENT_DELEGATION_THRESHOLD` |
| `agents.description_max_tokens` | `300` | a number | Lint (AG-003): the most tokens an agent description may hold. A positive whole number. | `agent_description_max_tokens` | `PAQAD_AGENT_DESCRIPTION_MAX_TOKENS` |
| `agents.report_max_tokens` | `2000` | a number | The most tokens an agent report may hold when its Report section names no smaller maximum. A positive whole number. | `agent_report_max_tokens` | `PAQAD_AGENT_REPORT_MAX_TOKENS` |
| `agents.prompt_max_tokens` | `3000` | a number | Lint (AG-014): the most tokens an agent body (its system prompt) may hold. A positive whole number. | `agent_prompt_max_tokens` | `PAQAD_AGENT_PROMPT_MAX_TOKENS` |
| `agents.max_tools` | `10` | a number | Lint (AG-018): the most tools an agent may list before it needs an approval packet. A positive whole number. | `agent_max_tools` | `PAQAD_AGENT_MAX_TOOLS` |
| `agents.max_cost_multiple` | `4` | a number | S5 agent evals: the most median cost an agent run may use, as a multiple of the main-thread baseline, unless it shows a parallel wall-time gain. 1 or more. | `agent_max_cost_multiple` | `PAQAD_AGENT_MAX_COST_MULTIPLE` |
| `agents.catalog_description_max_tokens` | `15000` | a number | Lint (AG-004): the most tokens all installed agent descriptions may hold together. A positive whole number. | `agent_catalog_description_max_tokens` | `PAQAD_AGENT_CATALOG_DESCRIPTION_MAX_TOKENS` |
| `agents.memory_max_lines` | `200` | a number | Lint (AG-010) and memory-consolidate: the most lines an agent MEMORY.md may hold. A positive whole number. | `agent_memory_max_lines` | `PAQAD_AGENT_MEMORY_MAX_LINES` |

### `feature-development/workflow.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `stop_after` | `none` | specification \| none | Stop after the spec phase; do not implement. | `spec_only_mode` | `PAQAD_SPEC_ONLY_MODE` |
| `stages.planning.research.market` | `false` | true \| false | Enable the market-research agent in planning. | `market_research` | `PAQAD_MARKET_RESEARCH` |
| `stages.planning.research.design` | `false` | true \| false | Enable the design-research agent in planning. | `design_research` | `PAQAD_DESIGN_RESEARCH` |
| `stage_helpers.team_agents` | `true` | true \| false | Use the multi-agent team for full-lane work. | `team_agents` | `PAQAD_TEAM_AGENTS` |
| `stages.planning.effort` | `high` | low \| medium \| high \| xhigh \| inherit | low \| medium \| high \| xhigh \| inherit. How hard the planning stage helper thinks. inherit uses the effort of the main session. Run `paqad-ai stage settings` to apply it on the next dispatch; the helper files keep the defaults. | `stage_effort_planning` | `PAQAD_STAGE_EFFORT_PLANNING` |
| `stages.planning.model` | `inherit` | inherit \| haiku \| sonnet \| opus | inherit \| haiku \| sonnet \| opus. The model the planning stage helper runs on. inherit uses the model of the main session. Run `paqad-ai stage settings` to apply it on the next dispatch; the helper files keep the defaults. | `stage_model_planning` | `PAQAD_STAGE_MODEL_PLANNING` |
| `stages.specification.effort` | `high` | low \| medium \| high \| xhigh \| inherit | low \| medium \| high \| xhigh \| inherit. How hard the specification stage helper thinks. inherit uses the effort of the main session. Run `paqad-ai stage settings` to apply it on the next dispatch; the helper files keep the defaults. | `stage_effort_specification` | `PAQAD_STAGE_EFFORT_SPECIFICATION` |
| `stages.specification.model` | `inherit` | inherit \| haiku \| sonnet \| opus | inherit \| haiku \| sonnet \| opus. The model the specification stage helper runs on. inherit uses the model of the main session. Run `paqad-ai stage settings` to apply it on the next dispatch; the helper files keep the defaults. | `stage_model_specification` | `PAQAD_STAGE_MODEL_SPECIFICATION` |
| `stages.development.effort` | `inherit` | low \| medium \| high \| xhigh \| inherit | low \| medium \| high \| xhigh \| inherit. How hard the development stage helper thinks. inherit uses the effort of the main session. Run `paqad-ai stage settings` to apply it on the next dispatch; the helper files keep the defaults. | `stage_effort_development` | `PAQAD_STAGE_EFFORT_DEVELOPMENT` |
| `stages.development.model` | `inherit` | inherit \| haiku \| sonnet \| opus | inherit \| haiku \| sonnet \| opus. The model the development stage helper runs on. inherit uses the model of the main session. Run `paqad-ai stage settings` to apply it on the next dispatch; the helper files keep the defaults. | `stage_model_development` | `PAQAD_STAGE_MODEL_DEVELOPMENT` |
| `stages.review.effort` | `high` | low \| medium \| high \| xhigh \| inherit | low \| medium \| high \| xhigh \| inherit. How hard the review stage helper thinks. inherit uses the effort of the main session. Run `paqad-ai stage settings` to apply it on the next dispatch; the helper files keep the defaults. You may lower it, but a lighter review catches less. | `stage_effort_review` | `PAQAD_STAGE_EFFORT_REVIEW` |
| `stages.review.model` | `inherit` | inherit \| haiku \| sonnet \| opus | inherit \| haiku \| sonnet \| opus. The model the review stage helper runs on. inherit uses the model of the main session. Run `paqad-ai stage settings` to apply it on the next dispatch; the helper files keep the defaults. | `stage_model_review` | `PAQAD_STAGE_MODEL_REVIEW` |
| `stages.checks.effort` | `low` | low \| medium \| high \| xhigh \| inherit | low \| medium \| high \| xhigh \| inherit. How hard the checks stage helper thinks. inherit uses the effort of the main session. Run `paqad-ai stage settings` to apply it on the next dispatch; the helper files keep the defaults. | `stage_effort_checks` | `PAQAD_STAGE_EFFORT_CHECKS` |
| `stages.checks.model` | `inherit` | inherit \| haiku \| sonnet \| opus | inherit \| haiku \| sonnet \| opus. The model the checks stage helper runs on. inherit uses the model of the main session. Run `paqad-ai stage settings` to apply it on the next dispatch; the helper files keep the defaults. | `stage_model_checks` | `PAQAD_STAGE_MODEL_CHECKS` |
| `stages.documentation_sync.effort` | `low` | low \| medium \| high \| xhigh \| inherit | low \| medium \| high \| xhigh \| inherit. How hard the documentation_sync stage helper thinks. inherit uses the effort of the main session. Run `paqad-ai stage settings` to apply it on the next dispatch; the helper files keep the defaults. | `stage_effort_documentation_sync` | `PAQAD_STAGE_EFFORT_DOCUMENTATION_SYNC` |
| `stages.documentation_sync.model` | `inherit` | inherit \| haiku \| sonnet \| opus | inherit \| haiku \| sonnet \| opus. The model the documentation_sync stage helper runs on. inherit uses the model of the main session. Run `paqad-ai stage settings` to apply it on the next dispatch; the helper files keep the defaults. | `stage_model_documentation_sync` | `PAQAD_STAGE_MODEL_DOCUMENTATION_SYNC` |
| `lanes.default` | `auto` | full \| auto | Route every task through the full (heaviest) lane by default. | `full_lane_default` | `PAQAD_FULL_LANE_DEFAULT` |
| `stages.review.adversarial_pass` | `required` | required \| optional | Require an adversarial review pass before delivery. | `require_adversarial_review` | `PAQAD_REQUIRE_ADVERSARIAL_REVIEW` |
| `stages.documentation_sync.stale_docs` | `block` | block \| warn | Block delivery when canonical docs are out of date. | `block_on_stale_docs` | `PAQAD_BLOCK_ON_STALE_DOCS` |
| `stage_tracking` | `block` | off \| warn \| block | off \| warn \| strict — feature-development stage-completeness gate (default strict). | `stages_mode` | `PAQAD_STAGES_MODE` |
| `stage_helpers.on_lanes` | `[full]` | a list | Comma-separated lanes (fast, graduated, full) on which each feature-development stage runs in its own stage helper on a host that can dispatch subagents (Claude Code, Codex). On other lanes the main agent runs every stage itself, with the same stages, artifacts and gates. Default: full. Set graduated,full to restore the old behaviour. full is always included; an empty or unreadable value gives the default. | `stage_isolation_lanes` | `PAQAD_STAGE_ISOLATION_LANES` |

### `feature-development/specification.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `pipeline.enabled` | `true` | true \| false | The grounded prompt->spec pipeline (`paqad-ai spec pipeline`). On by default on the graduated and full lanes; the fast lane never runs it. Set it to false to switch it off: feature-development then works as it did before the pipeline (FR-11). It sits upstream of the edit lock and feeds `spec freeze`. | `spec_pipeline_enabled` | `PAQAD_SPEC_PIPELINE_ENABLED` |
| `questions` | `warn` | off \| warn \| block | off \| warn \| strict — the switchable clarification (question-round) gate. warn (advisory): ask questions on an unclear prompt but never block. strict (required): ask and hold until answered or explicitly deferred. off: never ask. The fixed spine (grounding, no-invented-requirements, traceability) is never switchable. | `spec_pipeline_clarification` | `PAQAD_SPEC_PIPELINE_CLARIFICATION` |
| `final_review` | `off` | off \| warn \| block | off \| warn \| strict — the switchable final-review gate before freeze. off: show a non-blocking readable spec. warn (advisory): show and freeze. strict (required): a human must approve before freeze, recording a named human. Independent of the A5 gate. | `spec_pipeline_final_review` | `PAQAD_SPEC_PIPELINE_FINAL_REVIEW` |
| `pipeline.max_tokens` | `40000` | a number | Per-run model-token ceiling for the spec pipeline. Exceeding it raises a recorded warning (never a block) so R1 (over-heavy pipeline) is watched with data, not vibes. | `spec_pipeline_token_ceiling` | `PAQAD_SPEC_PIPELINE_TOKEN_CEILING` |
| `pipeline.grounding_timeout_ms` | `15000` | a number | Milliseconds `spec pipeline start` gives retrieval to ground the request. Past it, or with an empty index or no embedding key, start grounds on the docs alone and records grounding.mode=lexical-fallback with the reason. | `spec_grounding_budget_ms` | `PAQAD_SPEC_GROUNDING_BUDGET_MS` |
| `experts.enabled` | `true` | true \| false | The expert roster: a fast-tier skill decides which experts (db, security, ui, ...) a request needs, and their notes feed the crafted spec. On by default on the graduated and full lanes. Set it to false to switch it off: then zero Phase 2 code runs and a pipeline run is byte-identical to v1 (P2-INV-1). Needs spec_pipeline_enabled on to have any effect. | `spec_pipeline_experts_enabled` | `PAQAD_SPEC_PIPELINE_EXPERTS_ENABLED` |
| `hand_written_specs` | `block` | warn \| block | warn \| strict: how firmly the specification stage adopts the pipeline once spec_pipeline_enabled is on. strict (the default): `spec freeze` refuses a spec the pipeline did not produce; the only exit is `--manual --reason "<why>"`, which is recorded on the frozen spec. Set it to warn to soften this: the stage still tells the agent to produce the spec through `paqad-ai spec pipeline`, but a hand-written spec freezes, recorded as pipeline.produced=false and shown in the receipt. No effect while spec_pipeline_enabled is off. | `spec_pipeline_adoption` | `PAQAD_SPEC_PIPELINE_ADOPTION` |
| `experts.standing_on_lanes` | `[full]` | a list | Comma-separated lanes (graduated, full) on which the standing experts sit at every spec. On other pipeline lanes only the on-call experts the detector names are seated, plus security-auditor when a planned path is sensitive, and the High Table is skipped when nobody is named. Default: full. Set graduated,full to restore the old behaviour. full is always included. Review is unaffected. | `spec_pipeline_experts_lanes` | `PAQAD_SPEC_PIPELINE_EXPERTS_LANES` |
| `experts.standing` | `[product-owner, application-architect, user-flow-writer, qa-engineer]` | a list | Comma-separated expert roles that sit at the table on EVERY spec run once spec_pipeline_experts_enabled is on, whatever the detector picked. Default: product-owner,application-architect,user-flow-writer,qa-engineer. The other experts stay on call and are picked per request. Empty means no standing experts (the detector alone decides, as before). A role outside the expert roster is ignored with a doctor warning. No effect while the pipeline or the experts are off. | `spec_pipeline_standing_experts` | `PAQAD_SPEC_PIPELINE_STANDING_EXPERTS` |

### `feature-development/rules.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `loading` | `lean` | lean \| full | Token-neutral rule loading. ON (default) delivers the lean rule contract (manifest + only the rule text that applies to the files in play) and lifts the full-load mandate. OFF restores loading docs/instructions/rules in full every session. | `lean_rules` | `PAQAD_LEAN_RULES` |
| `enforcement` | `warn` | off \| warn \| block | off \| warn \| strict — scripted-rule enforcement from the working tree. | `rule_compliance` | `PAQAD_RULE_COMPLIANCE` |
| `before_edit.run` | `blocking_only` | blocking_only \| all | blocking-only \| all — rule scripts run before an edit. blocking-only runs only the deterministic changed-files scripts and the rest at turn end; all runs every script. | `rule_gate_pre_edit` | `PAQAD_RULE_GATE_PRE_EDIT` |
| `max_parallel` | `auto` | text | auto \| 1-8 — rule scripts run at once. auto = CPU cores minus one, at most 8; 1 runs them one after another. | `rule_gate_concurrency` | `PAQAD_RULE_GATE_CONCURRENCY` |
| `before_edit.budget_ms` | `6000` | a number | Time in ms (500-9000) the pre-edit rule check may take from the hook start, under both rule_gate_pre_edit values. Past it the edit goes ahead and the checks block at turn end. | `rule_gate_budget_ms` | `PAQAD_RULE_GATE_BUDGET_MS` |

### `feature-development/reuse.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `existing_code_digest.max_tokens` | `1000` | a number | Token budget for the feature-development "Existing surface" planning digest (existing symbols the model should reuse). Cards drop by rank past this budget. | `existing_surface_tokens` | `PAQAD_EXISTING_SURFACE_TOKENS` |
| `duplication.gate` | `warn` | off \| warn \| block | off \| warn \| strict — new-code duplication gate. warn (default) flags a near-copy of existing code; strict blocks it. Ships warn for a two-cycle bake-in. | `duplication_mode` | `PAQAD_DUPLICATION_MODE` |
| `duplication.min_similarity` | `0.9` | a number | Minimum similarity (0..1) for a blocking duplication finding. Default 0.90 — conservative, precision over recall. The 0.80–0.90 band routes to review, never blocks. | `duplication_similarity_threshold` | `PAQAD_DUPLICATION_SIMILARITY_THRESHOLD` |
| `duplication.min_lines` | `8` | a number | Minimum meaningful-line span a new code block must have to be scored for duplication. Default 8 — shorter snippets are never flagged. | `duplication_min_lines` | `PAQAD_DUPLICATION_MIN_LINES` |
| `create_vs_reuse.pause` | `warn` | off \| warn \| block | off \| warn \| strict — arm the create-vs-reuse decision pause from evidence. warn (default) reports the fork; strict opens a pause that blocks edits until answered. | `decision_arm_mode` | `PAQAD_DECISION_ARM_MODE` |
| `create_vs_reuse.min_similarity` | `0.85` | a number | Minimum name similarity (0..1) between a planned new construct and an existing symbol before it counts as a reuse fork. Default 0.85. | `decision_arm_plan_threshold` | `PAQAD_DECISION_ARM_PLAN_THRESHOLD` |
| `create_vs_reuse.max_pauses_per_change` | `1` | a number | How many evidence-armed decision pauses one change may open. Default 1 — only the strongest fork is asked; the rest are reported as warnings. | `decision_arm_max_per_change` | `PAQAD_DECISION_ARM_MAX_PER_CHANGE` |

### `feature-development/safety.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `database_review_for_migrations` | `required` | required \| optional | Require a database review when a change includes migrations. | `require_db_review_for_migrations` | `PAQAD_REQUIRE_DB_REVIEW_FOR_MIGRATIONS` |
| `destructive_operations` | `block` | block \| ask \| warn | block \| require_approval \| warn — for destructive operations. | `escalate_destructive_operations` | `PAQAD_ESCALATE_DESTRUCTIVE_OPERATIONS` |
| `risky_migrations` | `warn` | block \| ask \| warn | block \| require_approval \| warn — for risky migrations. | `escalate_risky_migrations` | `PAQAD_ESCALATE_RISKY_MIGRATIONS` |
| `security_findings` | `block` | block \| ask \| warn | block \| require_approval \| warn — for security findings. | `escalate_security_findings` | `PAQAD_ESCALATE_SECURITY_FINDINGS` |
| `large_data_change_rows` | `10000` | a number | Row count above which a data operation escalates. | `escalate_db_row_threshold` | `PAQAD_ESCALATE_DB_ROW_THRESHOLD` |

### `feature-development/checks.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `parallel` | `true` | true \| false | Run the checks stage concurrently and use the test runner's own parallel mode when the project has it. OFF restores the one-after-another run. | `checks_parallel` | `PAQAD_CHECKS_PARALLEL` |
| `max_processes` | `auto` | a number or auto | Cap on parallel test processes. 0 = auto (cores minus one, capped by memory and container limits). | `checks_max_processes` | `PAQAD_CHECKS_MAX_PROCESSES` |
| `mutation_testing` | `off` | off \| warn \| block | off \| warn \| strict: mutation testing on changed code. Opt-in: off by default. It runs only where the project calls runtime/scripts/verify-backstop.mjs from its own CI or pre-push hook, never at the end of an agent turn, and the project supplies the mutation tool for its stack. The project test command runs first; a red suite reads did not run. warn: a surviving mutant reads Inconclusive. strict: it fails the check. | `mutation_mode` | `PAQAD_MUTATION_MODE` |
| `flaky_tests` | `warn` | pass \| warn \| block | pass \| warn \| fail — what a test that fails in the parallel run but passes alone does. warn (default): never blocks, recorded, one receipt line. pass: recorded only. fail: blocks. Team value is the floor; local/env may only raise it. | `checks_flaky_under_parallel` | `PAQAD_CHECKS_FLAKY_UNDER_PARALLEL` |

### `feature-development/evidence.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `enterprise.enabled` | `false` | true \| false | Master switch for the enterprise/governance capabilities. | `enterprise` | `PAQAD_ENTERPRISE` |
| `enterprise.ledger` | `false` | true \| false | Write the receipt + evidence ledger set under .paqad/ledger/. | `enterprise_evidence_ledger` | `PAQAD_ENTERPRISE_EVIDENCE_LEDGER` |
| `enterprise.ai_bom` | `false` | true \| false | Write the CycloneDX ai-bom.json view. | `enterprise_ai_bom` | `PAQAD_ENTERPRISE_AI_BOM` |
| `enterprise.compliance_citations` | `false` | true \| false | Resolve framework citations into the receipt (token-spending path). | `enterprise_compliance_citations` | `PAQAD_ENTERPRISE_COMPLIANCE_CITATIONS` |
| `screenshots.enabled` | `false` | true \| false | Capture screenshots of documented flows for frontend changes as feature-bundle evidence. ON also requires the coding capability at its consumers. | `visual_evidence` | `PAQAD_VISUAL_EVIDENCE` |
| `report` | `true` | true \| false | Render a per-feature evidence report.html from the bundle at end-of-change. ON (default) is local, free, and zero-LLM. OFF stops writing the page. | `feature_report` | `PAQAD_FEATURE_REPORT` |
| `change_metrics` | `true` | true \| false | Compute the per-change shape metrics (duplication on new code + cross-file reuse rate) and surface them on the receipt, ledger, and dashboard. ON (default) is local, deterministic, and zero-LLM — it folds over caches the gates already produced. OFF stops computing and recording them. | `metrics_enabled` | `PAQAD_METRICS_ENABLED` |
| `bundle` | `block` | off \| warn \| block | off \| warn \| strict — end-of-change check that a feature-development bundle carries every required file (feature.json / plan / spec / review / stage-evidence / delivery, plus the flag-gated rule-run / change-metrics / duplication / report / rag / receipt / evidence / ai-bom). strict (default) FAILS the change when a required file is missing/empty/invalid, naming the file and its writer; warn surfaces it as Inconclusive without blocking; off falls back to the deprecated evidence_existence_gate. | `bundle_completeness` | `PAQAD_BUNDLE_COMPLETENESS` |
| `screenshots.gate` | `warn` | warn \| block | warn \| strict — how firmly the visual-evidence gate enforces once visual_evidence is on and a change is frontend-triggering. warn (default): an environmental miss (browser not provisioned, app not reachable, a failed selector, an absent/partial manifest) reads Inconclusive without blocking. strict: the same misses FAIL the change, and so does a frontend change with nothing captured because no documented flow or capture script exists, unless you attach screenshots (paqad-ai visual-evidence attach) or record a waiver decision (the gate prints the exact decision command). Under warn those skips stay skipped and show a skip line. Team value is the floor; local/env may only raise warn to strict. | `visual_evidence_mode` | `PAQAD_VISUAL_EVIDENCE_MODE` |
| `legacy_existence_check` | `warn` | off \| warn | DEPRECATED: superseded by bundle_completeness, which covers every bundle file and can fail. This warn-only check (rule-run / duplication / change-metrics / rag) now runs ONLY when bundle_completeness=off. warn (default) backfills the recoverable ones from the caches and reports an unrecoverable RAG gap as Inconclusive; it NEVER blocks. off disables it. | `evidence_existence_gate` | `PAQAD_EVIDENCE_EXISTENCE_GATE` |

### `feature-development/analytics.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `enabled` | `false` | true \| false | Opt in to complementary analytics instrumentation. OFF (default) is silent; ON authorizes wiring tracking + a per-event tracking-plan doc. | `analytics_instrumentation` | `PAQAD_ANALYTICS_INSTRUMENTATION` |
| `gate` | `warn` | off \| warn \| block | off \| warn \| strict — analytics instrumentation completeness. warn (default) flags a missing event doc; strict blocks on Done; opt-in, never auto-escalated. | `analytics_strictness` | `PAQAD_ANALYTICS_STRICTNESS` |

### `git-workflow/commits.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `ai_attribution` | `strip` | keep \| strip | keep \| strip — what happens to the CODING AGENT vendor attribution on your commits and PRs. strip (default) suppresses it where the provider exposes a project-level knob (Claude Code, Aider) and warns at delivery where it does not (Codex, Cursor are user-level only). paqad's own delivery footer is never touched by this knob. | `ai_attribution` | `PAQAD_AI_ATTRIBUTION` |

## git-workflow/

`git-workflow/` holds this team's rules for tickets, branches, commits, pull requests
and how strictly they're checked, in five YAML files: `tickets.yaml`, `branches.yaml`,
`commits.yaml`, `pull-requests.yaml` and `enforcement.yaml`.

- No personal override applies: `../.config` and `PAQAD_*` env vars don't change them.
  The one exception is `ai_attribution` in `commits.yaml`, which keeps its personal
  and env override.
- `paqad-ai update` adds new settings with a `# Added in paqad-ai <version>` line and
  never changes a value you set.
- The commit-msg and pre-push hooks check people's commits and pushes;
  `git commit --no-verify` skips them.
- Changes go through the `git-workflow` skill. Ask your agent, for example "make hotfix
  branches start from main".
