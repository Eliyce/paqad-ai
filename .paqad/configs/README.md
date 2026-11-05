# paqad team configuration (`.paqad/configs/`)

Tracked, team-shared settings, in YAML files that list the settings they could hold
when they were written, commented out with paqad's default and a note. A setting left
commented out uses paqad's default. Settings added later aren't listed in them.

- `paqad.yaml` — The package itself: on/off, updates, Claude Code install, HUD and Site Map.
- `models.yaml` — Which models paqad uses.
- `retrieval.yaml` — How paqad finds relevant code and docs (RAG).
- `decisions.yaml` — When paqad stops to ask you, in any workflow.
- `authoring.yaml` — How paqad writes and tests skills and helper agents, and its eval runs.
- `feature-development/workflow.yaml` — Lanes, stage helpers, stage tracking, and per stage: effort, model, extra reads and instructions.
- `feature-development/specification.yaml` — The spec pipeline, its questions, the final review and the experts.
- `feature-development/rules.yaml` — How project rules are loaded and enforced.
- `feature-development/reuse.yaml` — The existing-code digest, the duplication gate and the create-vs-reuse pause.
- `feature-development/checks.yaml` — What the checks stage runs and how: commands, parallel runs, flaky tests, mutation testing.
- `feature-development/evidence.yaml` — The proof a change leaves: bundle, report, metrics, screenshots and enterprise outputs.
- `feature-development/analytics.yaml` — Analytics instrumentation (opt-in).
- `git-workflow/` — the team rules for tickets, branches, commits, pull requests and
  enforcement (see below).

Run `paqad-ai config show` to see every setting, its value and where it comes from
(`--changed` lists only the ones that differ from the default).

## How to use

- Remove the `#` in front of a setting (and in front of its group name) to change it;
  put the `#` back to go back to the default.
- Gates use one vocabulary: `off | warn | block`.
- `paqad-ai update` regenerates this README when the settings list changes. It rewrites
  a team file only for a migration, a retired value or setting, or a stale workflow
  entry, and it says so. Find new settings in `../.config.example`.

## Personal overrides

A teammate can override a setting for themselves in the git-ignored `../.config`
(`<name>=<value>`, using the `.paqad/.config` name below), and a `PAQAD_*` env var
overrides everything. Both accept the values below as well as the older values.
`../.config.example` lists every name with its YAML home.

## Every setting

### `paqad.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `enabled` | `true` | true \| false | Turns paqad on or off for this project, and false lets you work without paqad. | `paqad_enable` | `PAQAD_ENABLE` |
| `team_bootstrap.enabled` | `true` | true \| false | Lets teammates and Claude Code cloud sessions set paqad up from this repo on their own. | `team_bootstrap_enabled` | `PAQAD_TEAM_BOOTSTRAP_ENABLED` |
| `updates.automatic` | `true` | true \| false | Pulls newer paqad versions in the background when a session starts. | `auto_update` | `PAQAD_AUTO_UPDATE` |
| `updates.minimum_version` | `latest` | text | The lowest paqad version this project runs on, where latest always tracks the newest version. | `minimum_version` | `PAQAD_MINIMUM_VERSION` |
| `updates.check_every_hours` | `12` | a number | How many hours pass between background checks for a newer paqad version. | `version_check_interval_hours` | `PAQAD_VERSION_CHECK_INTERVAL_HOURS` |
| `site_map.enabled` | `false` | true \| false | Keeps a checked map of the app's screens and user journeys under docs/site-map/ for coding projects. | `site_map` | `PAQAD_SITE_MAP` |
| `hud.band` | `true` | true \| false | Shows the paqad status band above the prompt in the Claude Code plugin, along with the /paqad command. | `hud_view` | `PAQAD_HUD_VIEW` |
| `hud.chime` | `false` | true \| false | Plays a short chime in the Claude Code plugin once each verdict lands. | `hud_chime` | `PAQAD_HUD_CHIME` |
| `claude_code.plugin_migration` | `off` | on \| off | Moves existing npm Claude Code users to the paqad plugin in the background, with npm kept as the fallback. | `plugin_migration` | `PAQAD_PLUGIN_MIGRATION` |
| `claude_code.install_mode` | `auto` | auto \| plugin \| settings | How this project installs paqad into Claude Code, where auto follows the plugin migration switch, plugin forces the plugin and settings keeps the npm hooks. | `claude_install_mode` | `PAQAD_CLAUDE_INSTALL_MODE` |

### `models.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `models.default` | `gpt-5` | text | The model used for routine work. | `model_default` | `PAQAD_MODEL_DEFAULT` |
| `models.reasoning` | `gpt-5` | text | The model used for heavy reasoning and planning. | `model_reasoning` | `PAQAD_MODEL_REASONING` |
| `models.fast` | `gpt-5-mini` | text | The cheap, fast model used for light steps. | `model_fast` | `PAQAD_MODEL_FAST` |

### `retrieval.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `enabled` | `false` | true \| false | Loads relevant code and docs into context through search. | `rag_enabled` | `PAQAD_RAG_ENABLED` |
| `embeddings.provider` | `(unset)` | local \| openai | Which embedding service builds the search index, and the local model is used when it is left unset. | `rag_embedding_provider` | `PAQAD_RAG_EMBEDDING_PROVIDER` |
| `embeddings.model` | `(unset)` | text | The embedding model to use instead of the default model of the provider. | `rag_embedding_model` | `PAQAD_RAG_EMBEDDING_MODEL` |
| `match.min_similarity` | `0.75` | a number | How similar (0 to 1) a piece of code or docs must be to the request before it is loaded. | `rag_similarity_threshold` | `PAQAD_RAG_SIMILARITY_THRESHOLD` |
| `match.fallback_min_similarity` | `0.35` | a number | A lower similarity score used when nothing reaches the main one, and the pieces it lets through are marked low confidence. | `rag_relief_floor` | `PAQAD_RAG_RELIEF_FLOOR` |
| `match.max_results` | `20` | a number | The most pieces of code or docs loaded for one search. | `rag_top_n` | `PAQAD_RAG_TOP_N` |
| `index.max_file_size_bytes` | `153600` | a number | Files larger than this many bytes are left out of the search index. | `rag_max_file_size` | `PAQAD_RAG_MAX_FILE_SIZE` |
| `index.base_branch` | `(unset)` | text | The base branch the search index compares against, found on its own (main, then master) when left unset. | `rag_base_branch` | `PAQAD_RAG_BASE_BRANCH` |

### `decisions.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `ask` | `often` | often \| balanced \| rarely | How often paqad stops to ask you instead of making a choice itself. | `decisions_ask_threshold` | `PAQAD_DECISIONS_ASK_THRESHOLD` |

### `authoring.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `skills.enabled` | `true` | true \| false | Turns on the checks and pipeline paqad runs when a skill is written or changed. | `skill_orchestrator_enabled` | `PAQAD_SKILL_ORCHESTRATOR_ENABLED` |
| `skills.trigger_threshold` | `0.9` | a number | The share of test queries (0 to 1) a skill description must handle correctly to pass its trigger test. | `authoring_trigger_threshold` | `PAQAD_AUTHORING_TRIGGER_THRESHOLD` |
| `skills.trigger_min_runs` | `2` | a number | How many of the three runs of each test query must fire the skill. | `authoring_trigger_min_runs` | `PAQAD_AUTHORING_TRIGGER_MIN_RUNS` |
| `skills.eval_min_gain_points` | `10` | a number | How many percentage points a skill must raise the pass rate over running without it. | `skill_eval_min_gain_points` | `PAQAD_SKILL_EVAL_MIN_GAIN_POINTS` |
| `skills.eval_max_token_multiple` | `2` | a number | The most tokens a skill run may use, as a multiple of a run without the skill. | `skill_eval_max_token_multiple` | `PAQAD_SKILL_EVAL_MAX_TOKEN_MULTIPLE` |
| `runs.per_arm` | `3` | a number | How many times each eval case runs with the skill and without it. | `authoring_runs_per_arm` | `PAQAD_AUTHORING_RUNS_PER_ARM` |
| `runs.max_iterations` | `3` | a number | The most revision rounds an eval loop runs before it stops. | `authoring_max_iterations` | `PAQAD_AUTHORING_MAX_ITERATIONS` |
| `skills.fact_max_age_days` | `60` | a number | Days a checked outside fact in the sources of a skill stays fresh before release asks for a recheck. | `authoring_fact_max_age_days` | `PAQAD_AUTHORING_FACT_MAX_AGE_DAYS` |
| `skills.collision_jaccard` | `0.4` | a number | How much word overlap (0 to 1) a new skill may have with an installed one before it counts as a clash. | `authoring_collision_jaccard` | `PAQAD_AUTHORING_COLLISION_JACCARD` |
| `skills.description_budget_chars` | `8000` | a number | The total characters of all installed skill descriptions before release warns that some may be dropped. | `authoring_description_budget_chars` | `PAQAD_AUTHORING_DESCRIPTION_BUDGET_CHARS` |
| `skills.body_max_tokens` | `5000` | a number | The most tokens the body of a skill file may hold. | `skill_body_max_tokens` | `PAQAD_SKILL_BODY_MAX_TOKENS` |
| `runs.tool_result_max_tokens` | `10000` | a number | A tool result larger than this many tokens is flagged as too large in an eval run. | `authoring_tool_result_max_tokens` | `PAQAD_AUTHORING_TOOL_RESULT_MAX_TOKENS` |
| `runs.cache_hit_min` | `0.7` | a number | The share of cache hits (0 to 1) below which an eval run is recorded as slow. | `authoring_cache_hit_min` | `PAQAD_AUTHORING_CACHE_HIT_MIN` |
| `skills.regression_tolerance` | `0.2` | a number | How far (0 to 1) the pass rate of a changed skill may fall below the old version before it fails. | `authoring_regression_tolerance` | `PAQAD_AUTHORING_REGRESSION_TOLERANCE` |
| `skills.dark_window_days` | `30` | a number | Days without a firing before a skill is reported as unused. | `authoring_dark_window_days` | `PAQAD_AUTHORING_DARK_WINDOW_DAYS` |
| `runs.batch` | `auto` | auto \| off | Whether trigger test queries are sent as one batch when the host offers it. | `authoring_batch_mode` | `PAQAD_AUTHORING_BATCH_MODE` |
| `runs.max_cost_usd` | `5` | a number | The most US dollars one eval or trigger run may spend before it stops and counts as failed. | `authoring_run_max_cost_usd` | `PAQAD_AUTHORING_RUN_MAX_COST_USD` |
| `runs.otel_endpoint` | `` | text | An OpenTelemetry address to also read usage numbers from, where empty reads them from the host only and paqad never sends transcripts there. | `authoring_otel_endpoint` | `PAQAD_AUTHORING_OTEL_ENDPOINT` |
| `agents.enabled` | `true` | true \| false | Turns on the checks and pipeline paqad runs when a helper agent is written or changed. | `agent_orchestrator_enabled` | `PAQAD_AGENT_ORCHESTRATOR_ENABLED` |
| `agents.pass_k_threshold` | `0.9` | a number | The score (0 to 1) an agent must reach when each of its eval cases runs three times. | `agent_pass_k_threshold` | `PAQAD_AGENT_PASS_K_THRESHOLD` |
| `agents.stage_pass_k_threshold` | `0.95` | a number | The score (0 to 1) an unattended stage agent must reach when each of its eval cases runs three times. | `agent_stage_pass_k_threshold` | `PAQAD_AGENT_STAGE_PASS_K_THRESHOLD` |
| `agents.delegation_threshold` | `0.9` | a number | The share of test requests (0 to 1) an agent description must route to the agent correctly. | `agent_delegation_threshold` | `PAQAD_AGENT_DELEGATION_THRESHOLD` |
| `agents.description_max_tokens` | `300` | a number | The most tokens an agent description may hold. | `agent_description_max_tokens` | `PAQAD_AGENT_DESCRIPTION_MAX_TOKENS` |
| `agents.report_max_tokens` | `2000` | a number | The most tokens an agent report may hold when the agent names no smaller limit. | `agent_report_max_tokens` | `PAQAD_AGENT_REPORT_MAX_TOKENS` |
| `agents.prompt_max_tokens` | `3000` | a number | The most tokens the instructions of an agent may hold. | `agent_prompt_max_tokens` | `PAQAD_AGENT_PROMPT_MAX_TOKENS` |
| `agents.max_tools` | `10` | a number | The most tools an agent may list before it needs an approval. | `agent_max_tools` | `PAQAD_AGENT_MAX_TOOLS` |
| `agents.max_cost_multiple` | `4` | a number | The most an agent run may cost, as a multiple of doing the work in the main session, unless it saves time by running in parallel. | `agent_max_cost_multiple` | `PAQAD_AGENT_MAX_COST_MULTIPLE` |
| `agents.catalog_description_max_tokens` | `15000` | a number | The most tokens all installed agent descriptions may hold together. | `agent_catalog_description_max_tokens` | `PAQAD_AGENT_CATALOG_DESCRIPTION_MAX_TOKENS` |
| `agents.memory_max_lines` | `200` | a number | The most lines the memory file of an agent may hold. | `agent_memory_max_lines` | `PAQAD_AGENT_MEMORY_MAX_LINES` |

### `feature-development/workflow.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `stop_after` | `none` | specification \| none | Stops a change once the spec is written, so nothing is implemented. | `spec_only_mode` | `PAQAD_SPEC_ONLY_MODE` |
| `stages.planning.research.market` | `false` | true \| false | Runs the market research helper during planning. | `market_research` | `PAQAD_MARKET_RESEARCH` |
| `stages.planning.research.design` | `false` | true \| false | Runs the design research helper during planning. | `design_research` | `PAQAD_DESIGN_RESEARCH` |
| `stage_helpers.team_agents` | `true` | true \| false | Uses a team of helper agents for work on the full lane. | `team_agents` | `PAQAD_TEAM_AGENTS` |
| `stages.planning.effort` | `high` | low \| medium \| high \| xhigh \| inherit | How hard the planning stage helper thinks, where inherit uses the effort of the main session and `paqad-ai stage settings` applies a change. | `stage_effort_planning` | `PAQAD_STAGE_EFFORT_PLANNING` |
| `stages.planning.model` | `inherit` | inherit \| haiku \| sonnet \| opus | The model the planning stage helper runs on, where inherit uses the model of the main session and `paqad-ai stage settings` applies a change. | `stage_model_planning` | `PAQAD_STAGE_MODEL_PLANNING` |
| `stages.specification.effort` | `high` | low \| medium \| high \| xhigh \| inherit | How hard the specification stage helper thinks, where inherit uses the effort of the main session and `paqad-ai stage settings` applies a change. | `stage_effort_specification` | `PAQAD_STAGE_EFFORT_SPECIFICATION` |
| `stages.specification.model` | `inherit` | inherit \| haiku \| sonnet \| opus | The model the specification stage helper runs on, where inherit uses the model of the main session and `paqad-ai stage settings` applies a change. | `stage_model_specification` | `PAQAD_STAGE_MODEL_SPECIFICATION` |
| `stages.development.effort` | `inherit` | low \| medium \| high \| xhigh \| inherit | How hard the development stage helper thinks, where inherit uses the effort of the main session and `paqad-ai stage settings` applies a change. | `stage_effort_development` | `PAQAD_STAGE_EFFORT_DEVELOPMENT` |
| `stages.development.model` | `inherit` | inherit \| haiku \| sonnet \| opus | The model the development stage helper runs on, where inherit uses the model of the main session and `paqad-ai stage settings` applies a change. | `stage_model_development` | `PAQAD_STAGE_MODEL_DEVELOPMENT` |
| `stages.review.effort` | `high` | low \| medium \| high \| xhigh \| inherit | How hard the review stage helper thinks, where inherit uses the effort of the main session and `paqad-ai stage settings` applies a change, and a lighter review catches less. | `stage_effort_review` | `PAQAD_STAGE_EFFORT_REVIEW` |
| `stages.review.model` | `inherit` | inherit \| haiku \| sonnet \| opus | The model the review stage helper runs on, where inherit uses the model of the main session and `paqad-ai stage settings` applies a change. | `stage_model_review` | `PAQAD_STAGE_MODEL_REVIEW` |
| `stages.checks.effort` | `low` | low \| medium \| high \| xhigh \| inherit | How hard the checks stage helper thinks, where inherit uses the effort of the main session and `paqad-ai stage settings` applies a change. | `stage_effort_checks` | `PAQAD_STAGE_EFFORT_CHECKS` |
| `stages.checks.model` | `inherit` | inherit \| haiku \| sonnet \| opus | The model the checks stage helper runs on, where inherit uses the model of the main session and `paqad-ai stage settings` applies a change. | `stage_model_checks` | `PAQAD_STAGE_MODEL_CHECKS` |
| `stages.documentation_sync.effort` | `low` | low \| medium \| high \| xhigh \| inherit | How hard the documentation_sync stage helper thinks, where inherit uses the effort of the main session and `paqad-ai stage settings` applies a change. | `stage_effort_documentation_sync` | `PAQAD_STAGE_EFFORT_DOCUMENTATION_SYNC` |
| `stages.documentation_sync.model` | `inherit` | inherit \| haiku \| sonnet \| opus | The model the documentation_sync stage helper runs on, where inherit uses the model of the main session and `paqad-ai stage settings` applies a change. | `stage_model_documentation_sync` | `PAQAD_STAGE_MODEL_DOCUMENTATION_SYNC` |
| `stage_tracking` | `block` | off \| warn \| block | How firmly paqad checks that every feature-development stage was run and recorded. | `stages_mode` | `PAQAD_STAGES_MODE` |
| `stage_helpers.on_lanes` | `[full]` | a list | The lanes on which each feature-development stage runs in its own helper agent, and full is always included. | `stage_isolation_lanes` | `PAQAD_STAGE_ISOLATION_LANES` |

### `feature-development/specification.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `pipeline.enabled` | `true` | true \| false | Writes the spec through the grounded spec pipeline on the graduated and full lanes. | `spec_pipeline_enabled` | `PAQAD_SPEC_PIPELINE_ENABLED` |
| `questions` | `warn` | off \| warn \| block | How firmly the spec pipeline asks about an unclear request, from never asking to holding until you answer. | `spec_pipeline_clarification` | `PAQAD_SPEC_PIPELINE_CLARIFICATION` |
| `final_review` | `off` | off \| warn \| block | Whether a person must read and approve the spec before it is frozen. | `spec_pipeline_final_review` | `PAQAD_SPEC_PIPELINE_FINAL_REVIEW` |
| `pipeline.max_tokens` | `40000` | a number | The model tokens one spec pipeline run may use before paqad records a warning. | `spec_pipeline_token_ceiling` | `PAQAD_SPEC_PIPELINE_TOKEN_CEILING` |
| `pipeline.grounding_timeout_ms` | `15000` | a number | Milliseconds the spec pipeline gives search to ground a request before it grounds on the docs alone. | `spec_grounding_budget_ms` | `PAQAD_SPEC_GROUNDING_BUDGET_MS` |
| `experts.enabled` | `true` | true \| false | Seats the experts a request needs, such as database or security, and adds their notes to the spec. | `spec_pipeline_experts_enabled` | `PAQAD_SPEC_PIPELINE_EXPERTS_ENABLED` |
| `hand_written_specs` | `block` | warn \| block | Whether the specification stage refuses a hand-written spec or only records that the pipeline did not write it. | `spec_pipeline_adoption` | `PAQAD_SPEC_PIPELINE_ADOPTION` |
| `experts.standing_on_lanes` | `[full]` | a list | The lanes on which the standing experts join every spec, and full is always included. | `spec_pipeline_experts_lanes` | `PAQAD_SPEC_PIPELINE_EXPERTS_LANES` |
| `experts.standing` | `[product-owner, application-architect, user-flow-writer, qa-engineer]` | a list | The expert roles that join every spec run, whatever the request needs. | `spec_pipeline_standing_experts` | `PAQAD_SPEC_PIPELINE_STANDING_EXPERTS` |

### `feature-development/rules.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `loading` | `lean` | lean \| full | Loads only the rule text that applies to the files in play, instead of every rule in full each session. | `lean_rules` | `PAQAD_LEAN_RULES` |
| `enforcement` | `warn` | off \| warn \| block | How firmly the scripted project rules are enforced on the working tree. | `rule_compliance` | `PAQAD_RULE_COMPLIANCE` |
| `before_edit.run` | `blocking_only` | blocking_only \| all | Which rule scripts run before an edit, either only the fast blocking ones or all of them. | `rule_gate_pre_edit` | `PAQAD_RULE_GATE_PRE_EDIT` |
| `max_parallel` | `auto` | text | How many rule scripts run at once, from 1 to 8, where auto uses the CPU cores minus one. | `rule_gate_concurrency` | `PAQAD_RULE_GATE_CONCURRENCY` |
| `before_edit.budget_ms` | `6000` | a number | Milliseconds (500 to 9000) the rule check before an edit may take, after which the edit goes ahead and the checks run at turn end. | `rule_gate_budget_ms` | `PAQAD_RULE_GATE_BUDGET_MS` |

### `feature-development/reuse.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `existing_code_digest.max_tokens` | `1000` | a number | The token budget for the list of existing code that planning asks the model to reuse. | `existing_surface_tokens` | `PAQAD_EXISTING_SURFACE_TOKENS` |
| `duplication.gate` | `warn` | off \| warn \| block | How paqad treats new code that nearly copies existing code, from a warning to a block. | `duplication_mode` | `PAQAD_DUPLICATION_MODE` |
| `duplication.min_similarity` | `0.9` | a number | How similar (0 to 1) new code must be to existing code before the duplication check blocks it. | `duplication_similarity_threshold` | `PAQAD_DUPLICATION_SIMILARITY_THRESHOLD` |
| `duplication.min_lines` | `8` | a number | The fewest meaningful lines a new block of code needs before it is checked for duplication. | `duplication_min_lines` | `PAQAD_DUPLICATION_MIN_LINES` |
| `create_vs_reuse.pause` | `warn` | off \| warn \| block | How paqad handles a planned new piece of code that looks like existing code, from a report to a pause that waits for your answer. | `decision_arm_mode` | `PAQAD_DECISION_ARM_MODE` |
| `create_vs_reuse.min_similarity` | `0.85` | a number | How similar (0 to 1) a planned new name must be to an existing one before paqad asks whether to reuse it. | `decision_arm_plan_threshold` | `PAQAD_DECISION_ARM_PLAN_THRESHOLD` |
| `create_vs_reuse.max_pauses_per_change` | `1` | a number | The most reuse pauses one change may open, with the rest reported as warnings. | `decision_arm_max_per_change` | `PAQAD_DECISION_ARM_MAX_PER_CHANGE` |

### `feature-development/checks.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `parallel` | `true` | true \| false | Runs the checks at the same time, using the test runner's own parallel mode when it has one. | `checks_parallel` | `PAQAD_CHECKS_PARALLEL` |
| `max_processes` | `auto` | a number or auto | The most test processes that run at once, where auto uses the CPU cores minus one within memory limits. | `checks_max_processes` | `PAQAD_CHECKS_MAX_PROCESSES` |
| `mutation_testing` | `off` | off \| warn \| block | Mutation testing on changed code, which runs only from the CI or pre-push hook of the project with its own mutation tool. | `mutation_mode` | `PAQAD_MUTATION_MODE` |
| `flaky_tests` | `warn` | pass \| warn \| block | What happens to a test that fails in the parallel run but passes alone, and a personal setting may only make it stricter. | `checks_flaky_under_parallel` | `PAQAD_CHECKS_FLAKY_UNDER_PARALLEL` |

### `feature-development/evidence.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `enterprise.enabled` | `false` | true \| false | Turns on the enterprise and governance outputs as a group. | `enterprise` | `PAQAD_ENTERPRISE` |
| `enterprise.ledger` | `false` | true \| false | Writes the receipt and evidence ledger for each change under .paqad/ledger/. | `enterprise_evidence_ledger` | `PAQAD_ENTERPRISE_EVIDENCE_LEDGER` |
| `enterprise.ai_bom` | `false` | true \| false | Writes an AI bill of materials (ai-bom.json, in CycloneDX format) for each change. | `enterprise_ai_bom` | `PAQAD_ENTERPRISE_AI_BOM` |
| `enterprise.compliance_citations` | `false` | true \| false | Adds compliance framework citations to the receipt, which spends extra tokens. | `enterprise_compliance_citations` | `PAQAD_ENTERPRISE_COMPLIANCE_CITATIONS` |
| `screenshots.enabled` | `false` | true \| false | Captures screenshots of documented flows as proof for frontend changes in coding projects. | `visual_evidence` | `PAQAD_VISUAL_EVIDENCE` |
| `report` | `true` | true \| false | Writes a local evidence report page for each change when it finishes, at no model cost. | `feature_report` | `PAQAD_FEATURE_REPORT` |
| `change_metrics` | `true` | true \| false | Measures duplication and reuse in the new code of each change and shows them on the receipt and dashboard. | `metrics_enabled` | `PAQAD_METRICS_ENABLED` |
| `bundle` | `block` | off \| warn \| block | How firmly paqad checks at the end of a change that its evidence bundle holds every required file. | `bundle_completeness` | `PAQAD_BUNDLE_COMPLETENESS` |
| `screenshots.gate` | `warn` | warn \| block | How firmly the screenshot check holds a frontend change with missing screenshots, and a personal setting may only make it stricter. | `visual_evidence_mode` | `PAQAD_VISUAL_EVIDENCE_MODE` |
| `legacy_existence_check` | `warn` | off \| warn | An older evidence check that runs only while the bundle check is off and never blocks a change. | `evidence_existence_gate` | `PAQAD_EVIDENCE_EXISTENCE_GATE` |

### `feature-development/analytics.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `enabled` | `false` | true \| false | Lets paqad wire analytics tracking into the app and keep a tracking plan doc for each event. | `analytics_instrumentation` | `PAQAD_ANALYTICS_INSTRUMENTATION` |
| `gate` | `warn` | off \| warn \| block | How firmly paqad checks that each analytics event has its tracking plan doc. | `analytics_strictness` | `PAQAD_ANALYTICS_STRICTNESS` |

### `git-workflow/commits.yaml`

| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |
|---|---|---|---|---|---|
| `ai_attribution` | `strip` | keep \| strip | Whether the attribution of the coding agent stays on your commits and pull requests, while the paqad delivery footer is never changed. | `ai_attribution` | `PAQAD_AI_ATTRIBUTION` |

## git-workflow/

`git-workflow/` holds this team's rules for tickets, branches, commits, pull requests
and how strictly they're checked, in five YAML files: `tickets.yaml`, `branches.yaml`,
`commits.yaml`, `pull-requests.yaml` and `enforcement.yaml`.

- No personal override applies: `../.config` and `PAQAD_*` env vars don't change them.
  The one exception is `ai_attribution` in `commits.yaml`, which keeps its personal
  and env override.
- `paqad-ai update` adds no settings to these files, and changes one only for a
  migration.
- The commit-msg and pre-push hooks check people's commits and pushes;
  `git commit --no-verify` skips them.
- Changes go through the `git-workflow` skill. Ask your agent, for example "make hotfix
  branches start from main".
