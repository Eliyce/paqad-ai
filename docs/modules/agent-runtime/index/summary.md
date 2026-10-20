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

## Why the capability skill scripts work the way they do

The scripts under `runtime/capabilities/*/skills/*/scripts/` find candidates; the model confirms
each one and decides severity. They share the lint contract described in the skill-runtime
module. The reasons below are not obvious from the code.

- **Portable shell.** The scripts must behave the same on macOS (Bash 3.2, BSD tools) and Linux
  (GNU tools, and mawk as Debian's default awk). So `[A-Z]` ranges are replaced by explicit
  character sets, since some POSIX locales collate them as `aBcD...` and match lowercase; awk
  regexes avoid `{n,m}` intervals, which mawk lacks; boundaries are written as explicit
  characters because POSIX ERE has no `\b`; lowercase goes through `tr` because `${var,,}`
  is not in older bash; a file list goes through a temp file and `read` rather than
  `mapfile`; and alternation patterns that are fragile under BSD grep use a `?` quantifier.
  awk's `match()` is case-sensitive even when grep used `-i`, so `check-terminology.sh`
  lowercases both sides and maps the match back to report the original casing.
- **Design contract parsers.** Each parser reads only the line shape its skill's `references/`
  checklist documents and ignores other lines with a note on stderr. `gap-report.sh` uses a
  deterministic id sequence so a re-run on the same contract yields the same ids for the model to
  match across runs. Gaps default to medium severity, since the contract is the contract.
- **Tokens.** `normalize-color.sh` turns hex and `rgb()` forms into lowercase six-digit hex
  (alpha dropped when fully opaque) so leaks match declared tokens by string equality. Named CSS
  colors are not resolved: they are leaks by definition. The scan's exclusion globs are kept in
  step with `references/token-leak-checklist.md`; `0px` and `1px` are skipped because they are
  usually borders.
- **States and motion.** Every file that mentions a component counts as exercising its default
  state. A file is safe from the reduced-motion check when it contains `prefers-reduced-motion`
  or framer-motion's `useReducedMotion(`.
- **Probing.** `probe-surfaces.sh` relies on curl printing `000` when the connection is refused
  or DNS fails, so an unreachable base is detected before any probe.
- **Findings hygiene.** `cryptographic-review` lint rejects long quoted base64-like strings so a
  raw secret never lands in a finding.

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
