---
'paqad-ai': minor
---

New `paqad-ai report speed` shows where each change's time went, from the stage ledger and the Claude Code session transcripts: busy time, the part owned by development, by the other stages and by the main agent alone, time spent waiting on a person, the edit gate's median and p90 latency with refused edits by reason, and whole-suite versus targeted test runs, then totals per lane and the five biggest categories of busy time. Use `--change <id>` for one change, `--since <date>` to start at a date, and `--json` for machines. It only reads, never prints prompt or tool text, and shows a "no transcript" row when a change's transcripts are gone.
