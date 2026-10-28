# Capability Model

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `capability-model`

## Purpose

Three capabilities — `content`, `coding`, `security` — that gate which
rules, skills, and agents activate. Content is always on; coding
activates on a pack match; security follows coding.

## What the capability gate answers

The capability gate (`runCapabilityGate` in `src/kernel/gate.ts`) answers a call in one of three
ways:

- **Pass:** nothing blocked. Advisory findings and context may ride along.
- **Block:** a capability blocked, and the hook exits 2.
- **Ask:** pre-mutation only. The person chose Allow once in the HUD for this exact call, so the
  gate returns `block: false` with `ask` set to `ALLOW_ONCE_REASON`, and the hook writes a
  PreToolUse `ask` so Claude Code's own dialog decides. It happens at most once per allowed
  call. The rules are in
  [rule-override technical](../../feature-evidence/features/rule-override/technical.md).

## Source Footprint

- `src/core/capabilities.ts`

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
