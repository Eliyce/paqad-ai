---
'paqad-ai': minor
---

Add `paqad-ai dashboard` and `paqad-ai status` — the living single-pane health overview for an onboarded paqad project.

`paqad-ai dashboard` starts a local web server (port 5372, auto-incrementing) on the same bundle as `paqad-ai graph`. The graph view is now one section inside the dashboard, opened via the architecture card; the existing `paqad-ai graph` command is unchanged and is still a direct shortcut to the graph route. Sections rendered in Phase 1: project profile, rules, workflows, decisions (living), module health (living), module docs, architecture, design system, stack, registries, tools, tech-debt, stack drift, framework version, RAG status, and — when present — pentest and session continuity. Each card shows a score badge, a one-line state-derived summary, a `?` helper popover, and up to three compact metrics. Score is existence + freshness only (file present + last-modified ≤ 30d = 100%, decays linearly to 0 at the 180d cliff); no content-quality heuristics in Phase 1. The summary band surfaces up to five "Needs your attention" items, critical-first. The card border pulses (200ms accent) when SSE re-fetch updates a section — the one allowed animation.

`paqad-ai status` is the same `buildReport()` pipeline, but one-shot — no server, no long-running process. Defaults to a deterministic Markdown rendering for humans / PR descriptions; `--format json` emits the stable `schemaVersion: 1` contract for agent prompts.

Zero install footprint: the bundle ships inside the package (mirroring the existing `runtime/graph-ui/` pattern), no new files are written into the user's project, scoring is computed on the fly, and no new MCP server or background process is introduced. Reuses every `--color-mod-*` design token already present in `graph-ui/src/index.css` — no new design tokens.

Closes #64.
