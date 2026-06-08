# Bidirectional Traceability Engine

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `traceability-engine`

## Purpose

Two silent failures slip past a wall of green checks: a **promise that was never
built** (nothing fails when a missing piece is simply absent) and **code nobody
asked for** (extra code doing who-knows-what). The traceability engine maintains
a **two-way map, rebuilt automatically from the real specs, code, and tests each
run**:

- **Forward** — every promise (one frozen acceptance criterion, owned by the
  [feature-spec](../../feature-development-workflow/index/summary.md), or an
  extracted obligation) links to the code that delivers it and the check that
  proves it.
- **Backward** — every code file links back to a promise, or to shared
  groundwork that something-with-a-promise actually **uses**.

It does not fork the existing subsystems — it **joins** them.

## The two flags

| Finding | Meaning |
| --- | --- |
| `TR-UNTESTED-PROMISE` | A promise with no proving check — "we said we'd do this and nothing tests it." |
| `TR-CODE-ORPHAN` | Code that answers to no promise **and** that nothing-with-a-promise uses — flagged by a reachability solver over the import graph, generalising the module map's `MM-DOC-ORPHAN` notion to code. |

**Shared groundwork passes by *use*, not by a label.** A file with no promise of
its own is accepted only if something that *does* have a promise reaches it
through the import graph. Reality (actual dependency) decides — a "this is fine"
comment can never suppress a truly-dead flag, because file *content* never
reaches the solver, only the edges do.

## Lane behaviour

- **`graduated` / `full`** — the full two-way build over the whole source tree.
- **`fast`** — a cheap subset: orphan-code flagging is restricted to the change
  set ("did this trivial change add code with no promise / no user?").

## Rebuilt from reality

The map is regenerated on every run from the current specs, code, and tests —
it is never a hand-maintained document that drifts. The
[`TraceabilityPhase`](../../../../src/pipeline/phases/traceability.ts) wraps the
`documentation-update` phase (which runs in every lane), gathers inputs from
disk, builds the map, and writes it to `.paqad/traceability/map.json`. It is
**non-blocking**: findings are *flagged* (surfaced as a warning), mirroring the
module-map drift channel — they never fail the build.

When no promise anchors are discoverable in a run, orphan flagging is
**suppressed** (with the reason recorded) rather than flagging the whole tree —
honest about what reality could and could not prove.

## Source Footprint

- `src/traceability` — the joiner (`map-builder.ts`), the reachability solver
  (`reachability.ts`), the input gatherer (`inputs.ts`), and the `map.json`
  writer (`writer.ts`).
- `src/pipeline/phases/traceability.ts` — the lane-gated phase decorator.

## Reused, not forked

| Joined subsystem | What it contributes |
| --- | --- |
| `compliance` (obligation-extractor / compliance-checker) | promises + the spec→test proving link |
| `verification` evidence (`ac_id`) | a check that targets a specific promise |
| `graph/import-scanner` | the import edges the reachability solver walks |
| `module-map` source-roots | the source tree to scan |

## Outputs

- `.paqad/traceability/map.json` — the full forward + backward map, findings, and counts.

## Hand-off to the quality ratchet

The reachability solver here emits the dead/orphan set; the **quality ratchet**
(issue #110) consumes that output as a ratcheted *trend* measure. One solver,
two uses — this module owns the reachability/intent view.

## Authority

The single source of truth for this module's identity, slug, feature names, and
source paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml).
If anything in this page disagrees with the map, the **map wins** — update the
map first, then regenerate this page via `create module documentation`.

## Related

- Module registry: [`docs/instructions/registries/modules.md`](../../../instructions/registries/modules.md)
- Module Map Engine: [`docs/modules/module-map-engine/index/summary.md`](../../module-map-engine/index/summary.md)
- Spec Compliance Engine: [`docs/modules/compliance-engine/index/summary.md`](../../compliance-engine/index/summary.md)
