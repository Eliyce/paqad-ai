# Skill Runtime

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `skill-runtime`

## Purpose

Discovers and invokes the 27+ skills shipped under
`runtime/base/skills/**`. Skills are the smallest reusable unit of
agent behaviour (scope-check, spec-diff, adversarial-review, etc.).

## Source Footprint

- `src/skills`
- `runtime/base/skills`

## Features

_This module has no enumerated features in the map; the module itself is the unit of work._

## Why the code works the way it does

- **`audit-events.ts`.** A skill or pack that fails to load writes an event to
  `.paqad/skills/events.jsonl` instead of failing silently, kept apart from the module-map events.
  Each event carries a SHA-256 of the offending bytes (or of the pack path when there is no
  manifest) so the consumer can de-duplicate; a later successful load writes nothing, which lets
  the consumer clear its badge. Events with no project root, or whose write failed, wait in one
  shared in-process buffer that drops the oldest when full, because loaders are short-lived. A
  flush writes the buffer first so order is kept, and an event whose write throws goes back into
  the buffer.
- **`loader.ts`.** A SKILL.md with bad frontmatter is left out and recorded; it no longer fails the
  whole batch. Other errors, such as an unreadable file, still propagate.
- **`runtime-registry.ts`.** Runtime skills live in memory only and are lost on restart. A name
  that clashes with a built-in is refused so the built-in stays the default match. Registration
  parses and stores with no `await` in between, and `snapshot` builds a new list each call, so a
  snapshot taken earlier never changes.

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
