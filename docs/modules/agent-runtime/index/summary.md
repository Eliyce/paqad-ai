# Built-in Agent Roles

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `agent-runtime`

## Purpose

22 roles shipped in `runtime/base/agents` and capability sub-trees,
backed by 26 persona files: 9 workflow roles (context-curator,
product-owner, verifier, test-planner, requirement-analyst, …), 12
coding specialists (solution-architect, application-architect,
database-expert, devops-engineer, qa-engineer, user-flow-writer,
chief-architect, …), and 1 security specialist (security-auditor). Six
personas back no role id and are reused (router, story-designer,
final-reviewer, adversarial-reviewer, app-cartographer, journey-designer).

## Source Footprint

- `runtime/base/agents`
- `runtime/capabilities`

## Features

_This module has no enumerated features in the map; the module itself is the unit of work._

## Why the `src/event-bus/` code works the way it does

`EngineEventBus` only enqueues on `emit` and drains in a microtask, so it never calls a subscriber
inline or blocks engine work. Each subscriber has a ring buffer; when it is full the oldest
droppable event is discarded and the next delivery carries an `events-coalesced` marker, which is
never dropped. Decision events are protected by default because a UI must not miss them; if the
buffer is full of protected events the incoming one is dropped so the engine never stalls. A
throwing subscriber faults only its own subscription. Large payloads have their strings truncated
and are tagged `truncated` instead of being rejected. Payloads are plain data so they can cross
IPC unchanged. The bus does not extend `EventEmitter`, so its surface stays `subscribe`, `emit`
and `unsubscribe`.

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
