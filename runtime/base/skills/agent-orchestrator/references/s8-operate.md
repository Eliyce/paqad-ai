# S8 operate

verified: 2026-11-01

- `paqad-ai agent learn <name> "<correction>" --scope <where> --source S-<n>` asks `authoring.improvement`; on yes the correction goes into the draft and the checks run again.
- `paqad-ai agent drift <name>` lists stale facts and a model change since the agent was proven.
- `paqad-ai agent regression <name>` compares the latest eval rerun with the one before: tokens, cost and p95 latency within 20%, and no pass^3 drop.
- `paqad-ai agent memory-consolidate <name> --file <MEMORY.md>` keeps memory within `agent_memory_max_lines` by consolidating, never by appending.
- `paqad-ai agent catalog` lists each agent's listing cost and last delegation, proposes retiring one dark for `authoring_dark_window_days`, and names an agent holding an expired power approval.
