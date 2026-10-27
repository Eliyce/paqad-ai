# Speed Report: API View

> Module: **Per-Feature Evidence Bundle** (`feature-evidence`) · Layer: `framework-internals` · Feature slug: `speed-report`

Read-only. No config key, no hook and no hooks.log line: the report only reads the ledger and
the session transcripts and writes nothing.

## `paqad-ai report speed`

```text
paqad-ai report speed [--change <id>] [--since <date>] [--json]
                      [--transcripts-root <dir>] [--project-root <path>]
```

- `--change`: report one change, by ULID, issue number (a leading `#` is allowed) or bundle name.
- `--since`: only changes whose window starts on or after this UTC date.
- `--json`: print the machine-readable report (`schema: paqad.speed-report/1`) instead of the
  table.
- `--transcripts-root`: the Claude Code transcripts folder. Default
  `<CLAUDE_CONFIG_DIR>/projects`, else `~/.claude/projects`.

Output: a table per change (busy time, time by owner, owner wait, edit gate median and p90,
test runs, top categories) with per-lane totals, or the same data as JSON. A change with no
transcript is listed with the status `no transcript`.

Exit codes: `0` on success; `1` with a one-line message on stderr for an unknown `--change` or
an unreadable `--since`. With paqad turned off for the project it prints a notice and builds no
report.

## Library surface

- `buildSpeedReport({ projectRoot, change?, since?, transcriptsRoot? })`,
  `renderSpeedReport(report)` and `SpeedReportInputError` in `src/speed-report/report.ts`.
- Transcript reading in `src/speed-report/transcripts.ts`; categories in
  `src/speed-report/classify.ts`.
