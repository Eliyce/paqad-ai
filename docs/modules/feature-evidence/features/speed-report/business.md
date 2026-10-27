# Speed Report: Business View

> Module: **Per-Feature Evidence Bundle** (`feature-evidence`) · Layer: `framework-internals` · Feature slug: `speed-report`

## Overview

A change built through paqad can take hours even when the code change is small. To make it
faster you first have to see where the time goes. `paqad-ai report speed` answers that from two
things the project already has: the stage ledger of each change bundle and the Claude Code
session transcripts. It shows, per change, how long agents were busy, which stage owned that
time, how long everyone waited on a person, how slow the edit gate was and how often tests ran.
Every speed fix can then show what it saved, and any team can see what paqad costs on its own
changes.

The technical contract lives at [`technical.md`](./technical.md).

## User Roles

- **Developer or Operator**: runs the report after a change, or across all changes, to see where
  the time went and whether a speed fix helped.
- **Team lead**: compares lanes and stages across changes from the totals block.

## CLI: `paqad-ai report speed`

```bash
paqad-ai report speed [--change <id>] [--json] [--since <date>]
```

- `--change <id>`: one change, by its ULID, issue number or bundle folder name.
- `--since <date>`: only changes whose window starts on or after that date, read as UTC
  (`2026-10-20` or `2026-10-20T10:00`).
- `--json`: the same report for machines.
- `--transcripts-root <dir>`: where the transcripts are. The default is
  `<CLAUDE_CONFIG_DIR or ~/.claude>/projects`.

The table has one row per change bundle:

| Column | Plain meaning |
| --- | --- |
| Lane | The lane the change ran on: fast, graduated or full. |
| Size | The files and lines the change wrote with Edit and Write inside its window, outside `.paqad/`. |
| Busy | Real wall time during which at least one agent (the main agent or any subagent) was working: thinking or running a tool. Two agents working at once count that time once. |
| Development | The part of Busy owned by the development stage agent. |
| Ceremony | The part of Busy owned by planning, specification, the experts, the chief architect, review, checks and documentation sync. |
| Orchestrator | The part of Busy owned by the main agent alone, with no stage agent working. |
| Owner wait | The time spent waiting on a person: answering questions, and the gap between an agent's turn end and the next real prompt. |
| Edit gate | The median and p90 time from an Edit or Write call to its result, and how many edits a gate refused, by reason (gate timeout, entry gate, other gate). |
| Test runs | How many whole-suite and targeted test runs the change made. |

After the rows come a totals block per lane (busy time and the share each owner took, owner
wait, the edit gate and the test runs) and the five categories that took the most busy time.

A change whose transcripts cannot be found prints a `no transcript` row and is left out of the
totals. Nothing is guessed.

## Business Rules

- **It only reads.** The report never writes into `.paqad/`, opens no network connection and
  starts no process.
- **It never prints private text.** Transcripts hold prompts, file contents and tool output. The
  report prints only numbers, category names, change ids, lanes and change titles. A refused edit
  is reduced to one of three fixed reasons the moment it is read; the hook's error text is
  dropped.
- **Who owns a second.** Busy time is walked in 10-second buckets. Each bucket belongs to the
  first agent working in it, in this order: development, checks, review, documentation sync,
  specification, expert, chief architect, planning, Explore, main. So when development runs, its
  time is development time even while the main agent also works. Only the real busy seconds in
  a bucket are shared out, so Development, Ceremony and Orchestrator add up to Busy.
- **The speed window is not the cost window.** The speed report measures a change from its first
  to its last stage-ledger row, padded 5 minutes on each side. The change cost
  (`cost.json`) measures from the change's open to its receipt or close. Each report keeps its own
  span on purpose: the speed window follows the work the ledger saw, the cost window follows what
  was billed.

## Error States

- An unknown `--change` id, or one that is not a plain id (for example `../x`): one error line
  naming the value, exit 1, no table.
- An unreadable `--since` date: one error line naming the value, exit 1, no table.
- paqad disabled for the project: one line saying so, nothing built.

## Glossary

- **Change window**: first to last `recorded_at` in the bundle's `stage-evidence.jsonl`, padded
  5 minutes on each side.
- **Injected message**: a user record that is not a person, such as a task notification, a
  subagent hand-back or Stop hook feedback. The time before it is waiting for a background agent,
  not owner wait.
