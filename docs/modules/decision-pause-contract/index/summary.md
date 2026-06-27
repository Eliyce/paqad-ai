# Decision Pause Contract

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `decision-pause-contract`

## Purpose

Agent-side contract enforced by `CLAUDE.md` / `AGENTS.md`: before any
flagged choice the agent writes a Decision Packet to
`.paqad/decisions/pending/D-{id}.json` and stops until the resolved
packet exists. Routed through the interactive question UI when
available.

### Decision-precedent enrichment (RAG buildout F25)

When a pause opens, `DecisionStore.writePending` enriches the packet's context with the
top few SIMILAR prior resolved decisions (read from `.paqad/decisions/resolved/**`), so
the developer sees the precedents they already set when answering. Ranking is
deterministic — same category plus question/context token overlap (`src/planning/decision-precedents.ts`,
`findDecisionPrecedents` / `formatDecisionPrecedents`) — with no embeddings and no LLM
call, capped to keep the token cost low and best-effort so a missing/corrupt store never
breaks the pause. It complements `findReusableDecision` (which auto-reuses an exact-kind
match) by only ADVISING on related-but-not-identical precedents the human still decides.

## Source Footprint

- `.paqad/decisions`
- `src/planning/decision-precedents.ts`

## Features

_This module has no enumerated features in the map; the module itself is the unit of work._

## Authority

The single source of truth for this module's identity, slug, feature names, and source paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml). If anything
in this page disagrees with the map, the **map wins** — update the map first, then regenerate this
page via `create module documentation`.

## How to Update These Docs

1. Edit `docs/instructions/rules/module-map.yml` if the module or feature names changed.
2. Run `create module documentation` in your AI agent (Claude Code, Codex, Cursor, …).
3. Review the regenerated business + technical pages per feature.

## Related

- Module registry: [`docs/instructions/registries/modules.md`](../../../instructions/registries/modules.md)
- Stack overview: [`docs/instructions/stack/overview.md`](../../../instructions/stack/overview.md)
- Architecture overview: [`docs/instructions/architecture/overview.md`](../../../instructions/architecture/overview.md)
