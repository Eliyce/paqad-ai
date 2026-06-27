# Smart Rule Loading

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `smart-rule-loading`

## Purpose

Replace "load all ~50K of rule text every session" with a deterministic,
token-lean scheme (RAG buildout Phase 2). The model always knows that every rule
exists and when it applies, while the full text of a rule is deferred until its
declared triggers match what is being touched — and script-enforced rules stay
enforced regardless of what is in context. This is deliberately deterministic
(declared triggers + scripts), never an embedding-RAG guess: omitting a rule is a
correctness failure.

This module rides the session-time injection seam (`context-seam`) for delivery
and the background-worker harness for freshness.

## Source Footprint

- `src/context/rule-manifest.ts`

## Features

- [Rule Manifest (always-resident index of every rule)](../features/rule-manifest/business.md)

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

- Delivery channel: [`docs/modules/context-seam/index/summary.md`](../../context-seam/index/summary.md)
- Rules bundle: [`docs/modules/rules-runtime/index/summary.md`](../../rules-runtime/index/summary.md)
- Module registry: [`docs/instructions/registries/modules.md`](../../../instructions/registries/modules.md)
