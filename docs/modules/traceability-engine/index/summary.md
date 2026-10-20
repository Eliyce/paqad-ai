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

## The change map: acceptance criteria against the tests that prove them

The map that is built in production is the **change map**,
from [`change-map.ts`](../../../../src/traceability/change-map.ts). It is built
at two points, and each one writes it to `.paqad/traceability/map.json` through
the same writer:

- **Stop verification.** The completion check builds it itself before the
  `ac-test-mapping` gate reads it, so the gate reads a real map even when
  `paqad-ai checks run` never ran.
- **`paqad-ai checks run`.** After the check report is written, from the same
  changed files and test results.

How it is built:

- **Promises** are the active change's frozen spec acceptance criteria whose
  `proof_type` is `automated`. Visual criteria stay with the visual-evidence
  gate and manual criteria need no test, so neither becomes a promise. A change
  with no frozen spec gets no change map at all.
- **Proofs** come only from test files changed on the branch (the working tree
  plus the branch's commits, from git). A test file proves a criterion when it
  names the criterion's id in a test title, a describe title, or an
  `@obligation <ID>` tag. The match is on a word boundary, so `AC-1` never
  matches `AC-10`, `AC-1x` or `AC-1.2`, and an id like `AC-TRACK-export`
  matches only itself. An unchanged test file never counts.
- **A failing test is not a proof.** When the recorded test results show a
  failing or erroring test that names a criterion, that criterion is not proved.
- **Compliance obligations** are kept as promises, but an obligation that shares
  an id with a frozen criterion is dropped with its proofs, so a whole-tree
  compliance scan can never prove a criterion the change did not.
- **No whole-tree scan.** The change map carries no delivering code, no markers
  and no import edges, so `anchors_known` stays false and orphan flagging stays
  suppressed. The readers that need a whole-tree map (scope drift and the
  dead-code ratchet measure) therefore read the same "no map" they read before
  change maps existed.
- **Marked as a change map.** The map carries `scope: "change"` and the bundle
  directory in `change`. When the next change has no frozen spec, the Stop
  verification ignores a change map an earlier change left behind.

A map that cannot be built or written is a logged warning. It never breaks
`checks run` or the Stop verification.

## How the ac-test-mapping gate reads it

| Situation | Gate reads |
| --- | --- |
| No frozen spec | not required: "No frozen spec, so no acceptance criteria to map." |
| A frozen spec but the map could not be built | did not run, saying the map is missing |
| A frozen spec with only visual or manual criteria | not required, naming them |
| An automated criterion with no proving test | fail, naming every unproven criterion |
| Every automated criterion proved | pass: "All N automated acceptance criteria map to a proving test." |

The gate always shows the detail it was given and never replaces it with a
canned line.

## The whole-tree gatherer

`gatherTraceabilityInputs` (in `inputs.ts`) gathers a whole-tree map: every
source file, the import graph, code markers, and the compliance reports. Nothing
in production calls it today; it stays as the input for a future whole-tree map.
A verification-evidence row whose gate failed names a promise whose check
failed, so its `ac_id` is never counted as a proof and takes away any proof that
promise had.

When no promise anchors are discoverable in a run, orphan flagging is
**suppressed** (with the reason recorded) rather than flagging the whole tree —
honest about what reality could and could not prove.

## Why the code works the way it does

- **`change-map.ts`.** Only source files can hold a test title; a test file over the size cap is
  not read, since it is a generated fixture. A file's size and content come from the same open
  handle, so nothing can swap it in between, and a deleted file in the changed list proves
  nothing. Titles inside `it.each([...])('title')` are found by skipping the table. A map that was
  built but could not be written is still handed to the gate.
- **`reachability.ts`.** A file is legitimate when it delivers a promise or is reachable from one
  over real import edges, so a dead cluster that imports itself is still flagged and no comment or
  label can suppress the flag. It works per file, reusing the import-scanner edges.
- **`writer.ts`.** Every write uses its own temp name, so `checks run` and the Stop hook writing at
  once never rename each other's half-written file into place. A corrupt read returns null.

## Source Footprint

- `src/traceability` — the joiner (`map-builder.ts`), the reachability solver
  (`reachability.ts`), the change-scoped gatherer (`change-map.ts`), the
  whole-tree gatherer (`inputs.ts`), and the `map.json` writer (`writer.ts`).
- Built from `src/verification/repository/repository-context.ts` (Stop
  verification) and `src/cli/commands/checks.ts` (`checks run`).

## Reused, not forked

| Joined subsystem | What it contributes |
| --- | --- |
| `compliance` (obligation-extractor / compliance-checker) | promises + the spec→test proving link |
| `verification` evidence (`ac_id`) | a check that failed for a specific promise, which takes its proof away |
| `feature-evidence` frozen spec | the automated acceptance criteria the change map promises |
| `graph/import-scanner` | the import edges the reachability solver walks |
| `module-map` source-roots | the source tree to scan |

## Outputs

- `.paqad/traceability/map.json`: the latest map, with forward and backward links, findings, and
  counts. In production this is the change map, marked `scope: "change"`.

## Hand-off to the quality ratchet

The reachability solver here emits the dead/orphan set; the **quality ratchet**
consumes that output as a ratcheted *trend* measure. One solver,
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
