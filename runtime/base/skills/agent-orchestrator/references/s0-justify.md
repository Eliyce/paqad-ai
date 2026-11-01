# S0 justify

verified: 2026-11-01

1. Write `task.md` in the workspace: the job, in the project's words.
2. Run the task three times the way the main conversation would do it, each in a fresh context. Save each run as `baseline/run-<n>.md`.
3. Write `<workspace>/baseline/verdicts.json` as one row per run: `run`, `passed`, `note`, `tokens`, `duration_ms` and `verbose_tokens_in_main`.
4. Run `paqad-ai agent justify <name> --task-file task.md --reason <key>`. The reason must be backed by the runs:
   - `verbose-output`: verbose output was at least a quarter of the main context.
   - `restriction`: `task.md` has a `## Restriction` section naming the tools to take away.
   - `summarisable`: the median run is longer than the report limit.
   - `cheaper-model`: the main conversation passed at least two of three runs, so a cheaper tier may do.
   - `parallel`: `task.md` has `## Pieces` with three or more, or `## Files` with ten or more.
   - `recurring-role`: `task.md` has a `## Recurs` section.
5. Refuse instead with `--refuse <case>` when the job is a quick change, needs back and forth, shares the main context, is latency bound, is a one-off, or a skill or a hook would do. A refusal writes nothing.
