# Speed Report: Technical View

> Module: **Per-Feature Evidence Bundle** (`feature-evidence`) · Layer: `framework-internals` · Feature slug: `speed-report`

## Module Boundaries

- `src/speed-report/transcripts.ts`: all file reading. Lists the bundles (`listFeatureDirs`),
  reads each bundle's ledger rows (`readFeatureStageUnit`, `rowRecordedAt`) and `feature.json`,
  finds the transcripts and turns each one into timed intervals in one pass with
  `scanTranscriptLines` (`src/cost/transcript-usage.ts`). It is the only place that knows the
  Claude Code transcript path rule.
- `src/speed-report/classify.ts`: pure rules, no file access. Injected-message markers, gate
  refusal reasons, framework re-reads, Bash prefix stripping and command categories, whole-suite
  versus targeted test runs, and the stage owner of a subagent type.
- `src/speed-report/report.ts`: aggregation and rendering. Clips intervals to the window, splits
  busy time into owner buckets, builds the per-lane totals and the top categories, and renders
  the table or the JSON.
- `src/cli/commands/report.ts`: the thin `report` command group with its one verb, `speed`. It
  parses flags, calls `buildSpeedReport` and prints.

## Inputs

- **Ledger.** Every `stage-evidence.jsonl` row with a `recorded_at` (rows without it are old
  schema and skipped). The window is the first to the last `recorded_at`, padded 5 minutes on
  each side. The sessions are the distinct `session_id` values minus `paqad-housekeeping`.
- **Transcripts root.** `--transcripts-root`, else `<CLAUDE_CONFIG_DIR>/projects`, else
  `~/.claude/projects` (`claudeConfigDir` in `src/install/plugin-migration.ts`). Tests and the
  fixture set the option or `CLAUDE_CONFIG_DIR`, so they never read the real home folder.
- **Transcript files.** First the paths the cost hook already recorded for the session
  (`recordCostSources`, read back with `readCostCache` from the session's HUD cost cache), kept
  only when they sit inside the transcripts root. Then, as the fallback, the derived files:
  `<root>/<project path with / . _ and space replaced by ->/<session>.jsonl` and
  `<session>/subagents/agent-*.jsonl`, whose type comes from the sibling `agent-*.meta.json`
  `agentType`.
- **Ids.** A `--change` value (after a leading `#`) and every ledger `session_id` must match
  `^[A-Za-z0-9_-]+$` before they are joined into a path. Anything else is never opened; a bad
  session reads as `no transcript`.

## Intervals

One pass per transcript file, in file order, on each `user` and `assistant` record's `timestamp`:

- A `tool_use` opens a tool interval; the `tool_result` with the same `tool_use_id` closes it.
  An interval over 1 hour is dropped. `Agent` intervals are skipped, because the subagent's own
  file covers that time. A `tool_use` with no result leaves no interval.
- Model thinking runs from the last tool result, injected message or human prompt to the next
  `assistant` record when the gap is under 15 minutes.
- A `user` record whose first 400 characters hold any of `<task-notification`,
  `Another Claude session sent`, `Stop hook feedback`, `<ci-monitor-event`, `<system-reminder`,
  `<side-sessions` or `Request interrupted` is an injected message. The gap before it is waiting
  for a background agent and is neither busy nor owner time.
- Any other non-tool-result `user` record is a human prompt. When the record before it is an
  `assistant` record (a turn end), the gap is owner time: `away` when over 30 minutes, else
  `reading and replying`. `AskUserQuestion` intervals are owner time, `answering questions`,
  whatever their length: the 1-hour drop is for busy tool intervals, and an owner who answers
  after three hours waited three hours.
- A line that is not JSON is skipped and counted in `bad_lines`.

## Categories

- Edit, Write and NotebookEdit: `blocked: gate timeout` when the result is an error naming
  `hook error` and `timed out`, `blocked: entry gate` when it names `agent-entry`,
  `blocked: other gate` for any other hook error, else `edit (including the pre-edit gate)`.
- Read of `AGENT-BOOTSTRAP`, `AGENT-ROUTER`, `CLAUDE.md`, `framework-path`, `session-context` or
  `docs/instructions/{stack,design-system,workflows}`: `framework re-read`.
- Bash, matched on the first real command after leading `cd …&&`, `export …&&` and `VAR=value`
  prefixes are stripped (the project path can hold spaces and the word `paqad-ai`):
  `paqad checks run`, `paqad CLI` (`stage`, `plan`, `spec`, `review`, `rules`, `decision`,
  `lane`, `route`, `debt`, `index`, `visual-evidence`), `tests`,
  `lint, type, format, build`, `git`, `waiting and polling` (`sleep`, `until`, `while`), else
  `read, search, other`. Thinking is `model thinking`.
- Test runs: `paqad-ai checks run`, `pnpm ci`, `pnpm test:coverage`, and a test command naming no
  `tests/` path, `.test.` file, directory or `-t` are whole-suite; the rest are targeted.

## Aggregation

- Every interval is clipped to the change window. Size, test runs and edit-gate samples count
  calls that start inside the window.
- **Busy** is the length of the union of all busy intervals across the main agent and every
  subagent.
- **Owners.** The window is walked in 10-second buckets on the clock. A bucket's busy seconds go
  to the first agent active in it, in the order development, checks, review, documentation_sync,
  specification, expert, chief-architect, planning, Explore, other subagents, main. The subagent
  type maps to its stage through `resolveAgentIdentity` and `stageForAgentName`. Development is
  the development stage, Ceremony is checks to planning, Orchestrator is main, and Explore or any
  other subagent type is `other_agents_ms`, shown in the totals only when it is not zero.
- **Owner wait** is the length of the union of owner intervals.
- **Edit gate**: median and p90 (nearest rank) of every Edit, Write and NotebookEdit latency, and
  the refusals counted by reason.

## Output

The JSON (`schema: paqad.speed-report/1`) holds `changes` (each with `change`, `title`, `lane`,
`status` `measured` or `no transcript`, and for measured changes the window, `size`, the `*_ms`
spans, `owner_wait` by category, `edit_gate`, `test_runs`, `categories` and `bad_lines`),
`totals` per lane and `top_categories`. Every value is a number, a category name, a change id, a
lane, a change title or a status word. Times are milliseconds.

## Error Handling

`SpeedReportInputError` carries the one-line message for an unknown `--change` or an unreadable
`--since`; the CLI prints it on stderr and sets exit code 1. An unreadable transcript is treated
as missing.

## Test Fixture

`tests/fixtures/speed-report/` holds three changes of this repo, built by `build-fixture.mjs`:
the bundles' `feature.json` and `stage-evidence.jsonl`, and only the transcript records inside
their windows (with one record of margin on each side). Home folder names read `x`; prompts,
tool results and written text are `x` lines of the same count; Bash commands keep their prefix
and plain words; refusal markers (`hook error`, `timed out`, `agent-entry`) and the first 400
characters of injected messages are kept; paths outside the repo become stable placeholders.
The report gives the same JSON on the real transcripts and on the fixture.
