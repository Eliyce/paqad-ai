# Module Map Inspection Commands

> **Layer:** `cli-commands` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `cli-module-map` &nbsp;·&nbsp; **Issue:** #80

## Purpose

The module map is the framework's business-language picture of the codebase, and
it drifts the moment code moves. This module is the terminal surface that keeps it
honest: reconcile the map against the real source tree, inspect the prospective
decisions that propose changing it, and read the append-only audit trail of every
change the map has accepted. It is the read/verify counterpart to the
[`module-map-engine`](../../module-map-engine/index/summary.md), which does the
building.

## Commands

```
paqad-ai module-map reconcile [--source-roots <a,b>] [--file-extensions <.ts,.tsx>] [--fail-on-drift] [--no-write] [--json]
paqad-ai module-decisions <list|show <id>|expire-stale|extract>
paqad-ai module-events <list|since <iso>|for-module <slug>>
```

| Command | What it does |
| --- | --- |
| `module-map reconcile` | Scans the source roots, compares them to `module-map.yml` and `docs/modules/`, and writes `.paqad/module-map/drift.json`. `--fail-on-drift` exits non-zero so CI can block on drift. |
| `module-decisions list` / `show <id>` | Inspect the MD-XXXX prospective decisions on disk — proposed additions, renames, or removals to the map. |
| `module-decisions expire-stale` | Transition past-TTL `proposed` decisions out of the pending set. |
| `module-decisions extract` | Run the module-attribution extractor against a prompt and emit JSON candidates. |
| `module-events list` / `since <iso>` / `for-module <slug>` | Read the append-only `.paqad/module-map/events.jsonl` audit trail, optionally windowed by time or filtered to one module slug. |

## Why three commands, one module

They form a single loop over the map's lifecycle:

1. **reconcile** detects that reality and the map disagree (drift).
2. **decisions** are the proposed, reviewable resolutions to that drift — each a
   durable MD-XXXX record with a TTL, not an ad-hoc edit.
3. **events** are the immutable record of what was actually accepted, so the map's
   history is auditable rather than inferred from git blame.

## Why the `src/module-decisions/` code works the way it does

- **`apply.ts`** is the one writer for `module-map.yml`. It snapshots the current file under
  `.paqad/module-map/history/` (an empty snapshot when none exists, so the history is complete),
  writes the new map through a temp file in the same folder and a rename, then appends the event.
  The rename is the atomic point; if a later step fails, the snapshot allows a rollback.
- **`extractor.ts`** uses a small, fixed pattern set with no model, and extending it is a
  framework change. Header patterns come first so "Module: foo" wins over "in the foo module", and
  a title-case run stops at the first lowercase word, so "new module Stripe Connect for payouts"
  yields "Stripe Connect". Module-level regexes have `lastIndex` reset before each use. Only
  near-collisions and unknown names need a decision; exact matches are already known.
- **`inferencer.ts`** runs only when the extractor found nothing, and never changes state. Name
  tokens count twice as much as path tokens, and the score is sized so one strong hit on a short
  prompt clears the default floor. It always offers a fallback choice so the packet is complete.
- **`schema.ts` and `store.ts`.** New ids are `MD-<ULID>`, so two branches never mint the same id
  and allocation does not read the folder; older `MD-0001` style ids still validate.
- **`events.ts`.** The reader skips a malformed line so a write cut short by a crash never
  poisons the trail. `run.cancelled` fires at most once per run.

## Source Footprint

- `src/cli/commands/module-map.ts` — `reconcile`.
- `src/cli/commands/module-decisions.ts` — decision inspection commands.
- `src/cli/commands/module-events.ts` — event-trail commands.
- `src/module-map/reconciler.ts`, `src/module-map/source-roots.ts` — the
  reconciliation engine the CLI drives.
- `src/module-decisions/**` — the MD-XXXX schema, store, extractor, inferencer,
  apply, and events writer.
- Reads/writes `.paqad/module-map/drift.json` and `.paqad/module-map/events.jsonl`.

## Boundaries

This module **owns** the terminal surface — argument parsing, output shape, and
exit codes — over the reconciler and the decisions/events stores. It does **not**
own map construction (that is `module-map-engine`) and it does **not** auto-apply
decisions: `reconcile` reports drift, and decisions are resolved deliberately.

## Authority

The single source of truth for this module's identity, slug, feature names, and
source paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml).
If anything here disagrees with the map, the **map wins** — update the map first,
then regenerate this page via `create module documentation`.

## Related

- Map construction engine: [`module-map-engine`](../../module-map-engine/index/summary.md)
- Documentation workflow that consumes the map: [`documentation-workflow`](../../documentation-workflow/index/summary.md)
- Module registry: [`docs/instructions/registries/modules.md`](../../../instructions/registries/modules.md)
