# Build in Small Pieces & Reconnect — Technical

> **Slug:** `slicing-and-reconnect` &nbsp;·&nbsp; **Issue:** #104

## Source footprint

| Concern | Location |
|---|---|
| Combine-reason field on a slice | `src/core/types/planning.ts` (`ExecutionSlice.combine_reason`) |
| Slice-granularity rule (one AC floor) | `src/planning/slice-granularity.ts` (`checkSliceGranularity`) |
| Granularity wired into manifest validation | `src/planning/manifest-validator.ts` (`SLICE_GRANULARITY_FLOOR`, `SLICE_COMBINE_REASON`) |
| One-at-a-time slice sequencing | `src/planning/slice-executor.ts` (`SliceExecutor.execute`) |
| Reconnect-to-whole check | `src/planning/reconnect-check.ts` (`computeReconnect`, `renderReconnectReport`) |
| Topological slice ordering | `src/planning/dependency-queue.ts` (`buildDependencyQueue`) |

## One acceptance criterion per slice

`checkSliceGranularity(manifest)` is the rule. For every slice on a non-`fast` lane it counts the
acceptance criteria the slice `covers` (ids matching `AC-\d+` that exist in the verification matrix):

- **0 criteria** → `below-floor`: the slice proves nothing independently testable.
- **>1 criteria without a `combine_reason`** → `combined-without-reason`: combining is allowed only when
  separating would break the work, and the exception must be recorded.

The check is folded into `validateManifest` as the errors `SLICE_GRANULARITY_FLOOR` and
`SLICE_COMBINE_REASON`, so a manifest that slices below the floor is simply invalid. The `fast` lane is
exempt — `checkSliceGranularity` returns `ok` immediately so trivial work keeps no slicing ceremony.

A criterion with multiple parts maps to **one** `VerificationCriterion` using its existing
`negative_cases` / `edge_cases` fields (Open Decision 2) — there is no sub-AC slicing and no new AC
model.

## Each slice fully through its checks before the next

The slice executor already enforces this on `graduated` / `full`: `execute()` is a `while (true)` loop
that prepares the next eligible slice, runs `executeSlice`, runs `runSliceGate` (criteria, regression,
full suite), and only then loops to prepare the following slice. Ordering follows
`buildDependencyQueue` — a topological sort over `depends_on` (Open Decision 3). The sequencing test
asserts the strict interleaving `execute:SL-1 → gate:SL-1 → execute:SL-2 → gate:SL-2`.

## Reconnect to the whole

`computeReconnect({ spec, slices, snapshot, lane })` is the post-slice coherence check. It anchors on the
**frozen** `FeatureSpec` (#102): an unfrozen spec returns `anchored: false`, every frozen criterion
`uncovered`, and `coherent: false` — there is no written anchor to reconnect to. With a frozen spec it
derives, against the frozen acceptance criteria:

- `uncovered_criteria` — a frozen criterion no slice `covers` (a coverage gap).
- `unproven_criteria` — a frozen criterion a slice covers but absent from `snapshot.covered_criteria`
  (built, not proven). The snapshot reuses the `PlanVsActualSnapshot` shape — no parallel coverage store.
- `unwired_seams` — a slice whose `depends_on` names a slice missing from the assembly (`dangling`), or a
  slice wired onto an upstream whose frozen criteria are not all proven (`upstream-unproven`).
- `contradictions` — a frozen criterion owned by more than one slice (`double-owned`), or a slice
  claiming a criterion absent from the frozen spec (`off-spec` drift).

`coherent` is true only when all four are empty. This is a real check, not a stamp: the test suite drives
it to `INCOHERENT` with a deliberately-incoherent assembly. `review` is `structural` by default and
`agent-re-read` on the `full` lane (Open Decision 1). `renderReconnectReport()` produces a checklist that
names each gap, mirroring the Definition-of-Done renderer (#102).

## Reuse, not rebuild

This feature reuses `VerificationCriterion`, `execution_slices`, the dependency queue, the slice
executor, and the `PlanVsActualSnapshot` shape. It adds one field (`combine_reason`) and two pure
checkers — no new acceptance-criterion model and no new slice store.
