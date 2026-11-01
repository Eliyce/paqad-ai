# Skill and Agent Authoring

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `medium` &nbsp;·&nbsp; **Slug:** `authoring`

## Purpose

Gates new and edited skills and agents before they are added. A change that creates or edits a
skill gets the Skill Orchestrator at the High Table and runs `paqad-ai skill` through nine gated
stages; a change that creates or edits an agent gets the Agent Orchestrator and runs `paqad-ai
agent` through nine gated stages (see [The agent pipeline](#the-agent-pipeline)). The
end-of-change check fails a change whose new or edited skill or agent has no passing or
overridden record. `src/skills` discovers and loads skills; `src/authoring` gates new and edited
skills and agents. The workspace, overlap, evidence, aggregation and catalog code takes the
artifact kind.

## Source Footprint

- `src/authoring`
- `src/cli/commands/skill.ts` (parses arguments and prints; every gate lives in `src/authoring`)
- `runtime/base/authoring/never-write.yaml`
- `runtime/base/skills/skill-orchestrator`
- `runtime/hooks/skill-activation.mjs` and `runtime/hooks/lib/skill-activation-core.mjs`
- `src/cli/commands/agent.ts` and `runtime/base/skills/agent-orchestrator`
- the delegation hook `runtime/hooks/agent-delegation.mjs` is owned by the claude-plugin module;
  `src/authoring/delegations.ts` reads its log

## The pipeline

Every verb validates `<name>` against the skill name pattern before it builds a path, writes its
artifact into the git-ignored workspace `.paqad/tmp/authoring/skills/<name>/`, passes agent text
through `redactSecrets` first, and refuses to start while an earlier gate has not passed, naming
the missing artifact and the command that produces it. No verb calls a model or the network.

| Stage | Verb | Artifact | Gate |
| --- | --- | --- | --- |
| S0 justify | `skill justify <name>` | `justification.md` | at least 1 of 3 no-skill baseline runs failed; 3 of 3 stops; `--exclusion` stops with a better home |
| S1 intake | `skill intake <name> <intake.yaml>` | `intake.yaml` | all 7 fields filled; `--gap` raises `authoring.intake_gap` |
| S2 evidence | `skill evidence <name> <sources.md>` | `sources.md`, `overlap.md` | one non-model source; no unresolved collision; no cross-scope name shadowing |
| S3 draft | `skill draft <name> --dir <folder> --trace <trace.md>` | `draft/<name>/`, `trace.md` | every instruction block maps to an S-ID or carries `accepted:` or `model-knowledge:` |
| S4 lint and tests | `skill lint <folder>`, `skill test <name>` | `lint.json`, `script-tests.json` | no blocking lint finding; risky scripts answered; reference checks clean; the 7 contract checks per script pass under the project's own test command, narrowed to the skill's test folder when the runner takes a path |
| S5 evals | `skill eval plan`, `skill eval record` | `iteration-N/`, `benchmark.json`, `analyst.md`, `report.html` | a new skill gains `skill_eval_min_gain_points` over the baseline (for a subjective skill, the blind comparator prefers the revised skill); in improve mode the pass rate falls no more than `authoring_regression_tolerance` below the old skill; median tokens within `skill_eval_max_token_multiple` |
| S6 trigger | `skill trigger plan`, `skill trigger record` | `trigger-eval.json`, `trigger-results.json` | best validation score at or above `authoring_trigger_threshold`, each query right in `authoring_trigger_min_runs` of 3 runs |
| S7 release | `skill release <name> [--portable]` | host skills folder, `.paqad/authoring/skills/<name>/evidence.json` and `CHANGELOG.md`, bundle `skill-<name>.json` | every earlier gate passed or holds an override; input hashes unchanged; no stale external fact |
| S8 operate | `skill learn`, `skill drift`, `skill catalog` | gotchas, `drift.md`, catalog report | see below |

`skill status <name>` prints every gate in plain words with its artifact path, names the entry
(`justify` for a new skill, `improve` for an installed one) and the command to run next.
`skill improve <name>` snapshots the installed folder to `skill-snapshot/` before any edit and
skips S0 (and S1 when `intake.yaml` exists). `skill override <name> --gate <gate> --decision <id>`
records `{gate, reason, by, at}` only from a resolved `authoring.override` decision; `--ask
"<why>"` raises one. A secret (SK-011) can never be overridden.

## Decisions the owner is asked

Only business questions become decision packets: `authoring.overlap`, `authoring.risky_script`,
`authoring.intake_gap`, `authoring.improvement`, `authoring.retirement` and `authoring.override`.
A gate a skill cannot pass is never a question: the verb appends `{skill, gate, evidence_path, at}`
to `.paqad/ledger/authoring/defects.jsonl` and prints "I couldn't get the skill <name> through
its <gate> check, so I didn't add it. The evidence is in <path>. This is ours to fix, not yours."
An S0 stop is not a failure and writes no defect.

## The lint

`lintSkillFolder` (`src/authoring/lint/skill-lint.ts`) applies SK-001 to SK-019. Findings are
`{rule, severity, file, line, message}` sorted by file, line and rule, byte-identical across runs
and operating systems; the exit code is 0 with no blocking finding, 1 with one, 2 on a usage error.
Choices the issue left open:

- SK-001 also blocks a `.yaml` or `.yml` file in the folder that does not parse, naming its line,
  as it does an unreadable frontmatter.
- SK-003 checks each hyphen-separated word of the name; SK-004 warns whenever the first word does
  not end in "ing" (gerund names are the catalog rule).
- SK-006 allows the six open-spec fields, plus Claude Code's documented fields
  (`CLAUDE_CODE_SKILL_FIELDS`, with the date they were checked) when the project uses Claude Code,
  plus the paqad runtime loader's fields for a skill under the paqad repository's runtime roots.
- SK-012 to SK-015 read markdown files. SK-017 skips the frontmatter and lines marked
  `verified`, `human-verified` or `learned`, so references can carry their verification date and
  gotchas their date.
- SK-010 flags `read` only as a shell command, and looks for a test file named after the script in
  `tests/skills/<name>/` or `tests/Feature/Skills/<Name>/`.
- SK-011 reuses the codebase-health secret patterns (`src/codebase-health/secret-patterns.ts`)
  and reports only a redacted fingerprint. A file whose first 8000 bytes hold a NUL byte is
  binary and skipped.

The never-write list lives in `runtime/base/authoring/never-write.yaml`; a project may add
phrases in `docs/instructions/rules/authoring/never-write.yaml` and can never remove one.

## Script and reference tests (S4)

`paqad-ai skill test` runs the project's own `commands.test`, with `PAQAD_SKILL_UNDER_TEST` set
to the absolute path of the draft folder so contract tests can load a script that is not released
yet; a test falls back to the host path when the variable is unset. Each script needs seven tests
named `<script> <check>` (help, invalid input, fixture output, idempotency, dry run, output size,
secrets). Before anything runs, a static scan of each script and of the `hooks` and `shell`
frontmatter values raises `authoring.risky_script` for network, package-install or file-delete
calls; an Allow is bound to the script's content hash. Reference checks need every named path or
npm, pnpm, yarn, composer, make or just script to exist (or the line to say `external`), every
block tagged `runnable` to exit 0, every example tagged `validates=<file>` to parse and use only
keys that file has (JSON and YAML; other formats need `human-verified: <date>`), and a
`verified:` or `human-verified:` date. Framework console commands are not checked yet
(TD-01M69AJBSK7DRB2XJ3YW0XDBVA).

The test command is narrowed to the skill's own test folder when the runner takes a path
(Vitest, Jest, pytest, PHPUnit, Pest, artisan test, Mocha, directly or through the package test
script; npm gets its `--` separator), so S4 runs the skill's tests and not the whole suite. Any
other runner keeps the full command. The command that ran is recorded in `script-tests.json`.

A draft handed to `skill draft` from a paqad runtime skill folder, or an improve-mode runtime
source, is linted with the paqad runtime loader fields (`model_tier`, `triggers` and the rest) and
released back into that folder.

## Evals and trigger tests (S5, S6)

`eval plan` picks the adapter: `claude-plugin-eval` on Claude Code at or above the floor in
`CLAUDE_PLUGIN_EVAL_SUPPORT`, `subagent-dispatch` on older Claude Code, Codex and in improve mode,
`none` on a host without subagents (raising `authoring.override`). It prints one command per
model tier (`model_fast`, `model_reasoning`) with `--max-cost-usd` from
`authoring_run_max_cost_usd`, the run count and the worst-case spend. `eval record` validates the
results, marks an interrupted iteration partial and never aggregates it, aggregates the rest
(`aggregate.ts`, a port of skill-creator's `aggregate_benchmark.py`), writes `analyst.md`, and
records tokens as not measured where the host reports none. A `claude plugin eval --json` result
(schemaVersion 1) lists each case as `arms.with[]` and `arms.without[]`; a run scores the graders
that count towards the score (scored, not with-only), and a run that errored passes none. The revision loop stops on
`--feedback-empty`, after two iterations with no improvement, or at `authoring_max_iterations`,
through the build-check-fix loop breaker. `trigger plan` splits the queries 60/40 with seed 42;
`trigger record` scores every iteration, discards descriptions over 1024 characters, keeps the
best validation score, rechecks overlap and writes the chosen description into the draft, where
the old one stood, leaving the file untouched when it is unchanged. It is written as a plain
scalar, or as a folded block when a plain one would not read back, so a formatter run leaves it
alone.

## Release and the completion check

Release re-lints the final folder and recomputes each gate's input hash (S4 and S5 without the
description, S6 the whole folder), refusing with the stage to rerun on a mismatch. A symlink in
the folder is counted in every folder hash and refused at release, as is any file that resolves
outside the folder; the lint scans a symlink that stays inside the folder for secrets and blocks
one that leads outside (SK-011). The portable
copy moves Claude Code-only fields under `metadata` and passes `quick-validate.ts` (a port of
`quick_validate.py`); an unverified skill or one with an allowed risky script gets none.

`bundleCompletenessGate` checks every skill folder the change added or edited: it needs
`skill-<name>.json` with status `passed` or `overridden` whose `folder_hash` matches the shipped
folder, else "The skill <name> changed but never went through its checks. Run paqad-ai skill
status <name>." A removed skill, a change with no skill path, and
`skill_orchestrator_enabled=false` are judged as before. Only `paqad-ai skill release` writes the
record; the bundle allowlist accepts `skill-<name>.json` and the bundle-write guard names that
verb.

## Operate (S8) and the activation log

On Claude Code a PostToolUse hook (matcher `Skill|Read`) appends one line per firing to
`.paqad/ledger/authoring/activations.jsonl`. `skill catalog` streams it, drops lines older than
twice `authoring_dark_window_days`, and reports trigger rate, dark skills with their listing cost,
rivals, user-invoked skills that lack `disable-model-invocation`, and how many skills were added
(`evidence.json`) and refused (`defects.jsonl`). `skill learn` adds a dated, scoped gotcha to an
improve-mode draft once `authoring.improvement` is answered yes. `skill drift` lists externally
verified facts older than `authoring_fact_max_age_days`. The activation and defect ledgers are
operational: they are always written locally, whatever the enterprise knobs say.

## The agent pipeline

Agent paths are the agents folders of hosts that run subagents (`.claude/agents/`,
`.codex/agents/`) and, in this repo, the stage, plugin and persona roots; files under any other
host are ignored. The workspace is `.paqad/tmp/authoring/agents/<name>/` and the tracked evidence
`.paqad/authoring/agents/<name>/`.

| Stage | Verb | Artifact | Gate |
| --- | --- | --- | --- |
| S0 justify | `agent justify <name> --task-file --reason` | `justification.md` | a reason backed by three baseline runs; `--refuse` writes nothing |
| S1 intake | `agent intake <name> <intake.yaml>` | `intake.yaml` | all 14 fields filled and valid; `--preset explore` fills the `Explore` override |
| S2 evidence | `agent evidence <name> <sources.md>` | `overlap.md` | one non-model source; no unresolved overlap with an agent or expert |
| S3 draft | `agent draft <name> --file --trace` | `draft/`, `trace.md`, `brief-template.md` | every block traced; body headings in order; the BLOCKED report shape |
| S4 lint and tests | `agent lint`, `agent test <name>` | `lint.json`, `script-tests.json` | AG-001 to AG-022 clean; risky powers approved by a resolved `authoring.agent_permission` packet; hook script tests (blocks, allows, invalid input) green |
| S5 evals | `agent eval plan`, `agent eval record` | `iteration-N/`, `benchmark.json` | pass^3 at `agent_pass_k_threshold` (stage agents `agent_stage_pass_k_threshold`) on the cheapest tier, a gain over the baseline, cost within `agent_max_cost_multiple`; worst-case spend printed first |
| S6 delegation | `agent delegation plan`, `agent delegation record` | `delegation-results.json` | validation at or above `agent_delegation_threshold`; the chosen description is written into the draft; dispatched agents skip |
| S7 release | `agent release <name>` | host files, `<name>.agent.json`, `evidence.json`, `CHANGELOG.md`, bundle `agent-<name>.json` | earlier gates passed or overridden; the agent and its hook scripts unchanged since they were judged |
| S8 operate | `agent learn`, `drift`, `regression`, `memory-consolidate`, `catalog` | `learn.json`, `drift.md`, `regression.json`, `memory-curation.json` | the regression gate allows 20% on tokens, cost and p95 latency and no pass^3 drop |

Hashes bind the agent text and the hook scripts it names, not their paths, so a permission
approved on the draft copy still holds on the released file and an edit to either needs a rerun.
Release writes the Claude Code Markdown and the Codex TOML from one source; a host that runs no
subagents, or a form that would drop a tool restriction or blocking hook the agent relies on, gets
no file and is recorded `deployable: false` with a skill proposed. A plugin agent moves its
must-not rules to SubagentStart and SubagentStop settings hooks. The end-of-change check needs a
passed or overridden `agent-<name>.json` whose file hash matches each changed agent file (or the
agent whose hook script changed), and names an agent whose power approval has expired.

The delegation hook logs `{agent, request_id, session_id, at, tokens, duration_ms, status}` for
every Agent or Task call and SubagentStop to `.paqad/ledger/authoring/delegations.jsonl`; it
prints nothing and never blocks. `agent catalog` uses it for the last delegation and dark agents.

## Configuration

The 18 skill keys and the 11 `agent_*` keys live in the policy group under "Skill and agent authoring"; `readAuthoringConfig`
falls back to the default for an out-of-range value and `paqad-ai doctor` names it.
`skill_orchestrator_enabled=false` turns off the seat, the lane raise, the pipeline verbs, the
completion check and the activation log. `agent_orchestrator_enabled=false` does the same for
agents and the delegation log.

## Attribution

`src/authoring/eval/aggregate.ts`, `src/authoring/package/quick-validate.ts` and the grader,
comparator and analyst briefs of the skill-orchestrator skill are adapted from Anthropic's
skill-creator under the Apache License 2.0; see the repository `NOTICE`.
