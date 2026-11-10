# Agent Routing & Capability Lanes

> **Layer:** `agent-workflows` &nbsp;·&nbsp; **Confidence:** `medium` &nbsp;·&nbsp; **Slug:** `agent-routing`

## Purpose

How the router agent picks the right downstream specialist, how
capabilities (content / coding / security) gate which agents are
callable, and how strictness flags promote tasks to the full lane
(requires adversarial review, blocks on stale docs, etc.).

## Source Footprint

- `runtime/base/agents/router.md`
- `src/core/capabilities.ts`

## Features

_This module has no enumerated features in the map; the module itself is the unit of work._

## Rules discovery route

- `rules-discovery` is a routed workflow that loads the rule contract and runs no rule-scripts at turn end. The `rules-discovery` skill sequences it.
- Verbs: `paqad-ai rules inventory` and `paqad-ai rules discovery start | status | decisions | research | propose | review | sign-off | apply | docs`. They are separate from the top-level `paqad-ai discovery` command.
- Each run keeps its files in `.paqad/ledger/rules-discovery/<run_id>/` (`run.json`, `stack-inventory.json`, `from-decisions.json`, `from-research.json`, `sources.json`, `proposal.json`, `proposal.md`, `apply.json`, `report.json`). Only a verb moves `run.json` to the next step, with an expected-revision check.
- The step list is in `docs/instructions/workflows/rules-discovery.yaml`.

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
