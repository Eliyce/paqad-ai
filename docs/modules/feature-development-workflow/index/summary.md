# Feature Development Workflow

> **Layer:** `agent-workflows` &nbsp;·&nbsp; **Confidence:** `medium` &nbsp;·&nbsp; **Slug:** `feature-development-workflow`

## Purpose

Generic feature-delivery pipeline assembled from YAML in
`docs/instructions/workflows/`. Routes through requirement analysis,
story design, parallel implementation + tests, adversarial review,
and verification. Conditional and parallel steps supported.

## Source Footprint

- `docs/instructions/workflows/feature-development.yaml`
- `src/workflows`

## Features

- [Lane & Complexity Routing](../features/routing/business.md)
- [Parallel Step Execution](../features/parallel-execution/business.md)
- [Conditional / Failure Handling](../features/conditional-steps/business.md)
- [Resumable Runs](../features/resumable-runs/business.md)

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
