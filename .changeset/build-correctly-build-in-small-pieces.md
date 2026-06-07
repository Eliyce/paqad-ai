---
'paqad-ai': minor
---

feat: build in small pieces, then reconnect to the whole (#104)

Planning now pins the default slice unit to **one acceptance criterion**. On the graduated/full lanes a
slice that proves no independently-testable criterion is rejected (`SLICE_GRANULARITY_FLOOR`), and a
slice that bundles several criteria must record why separating them would break the work
(`SLICE_COMBINE_REASON`, via a new `ExecutionSlice.combine_reason`). The slice executor already takes each
slice fully through its checks before the next begins; that one-at-a-time ordering is now pinned by test.
After the slices are built, a new **reconnect check** confirms the assembled pieces fit the _frozen_
whole-feature spec (#102) — every frozen criterion covered and proven, no off-spec or double-owned
criterion, no unwired cross-slice seam — anchored on the written spec, not the agent's memory. It is a
real check that fails on an incoherent assembly, structural by default and escalating to an agent
re-read on the full lane. The fast lane is untouched: trivial work still builds in one step with no
slicing or reconnect ceremony. Reuses `VerificationCriterion`, `execution_slices`, and the
plan-vs-actual snapshot — no new acceptance-criterion model and no new slice store.
