---
'paqad-ai': minor
---

Feature bundles are now provably complete. A finished feature-development change must leave every required file in its evidence bundle, and a missing one now fails the change instead of passing silently (issue #511):

- `feature.json` finally has a writer — seeded when a feature opens and updated on rename / lane / spec-freeze / close, so a bundle records what it is instead of only its directory name.
- `delivery.json` is seeded at open with the branch and base, so the first commit on a branch links; it also records a `commit_decision` (committed / declined / never asked) and reconciles from git at end-of-change.
- A single declarative manifest states, per bundle file, when it is required and who writes it, guarded by a test so a future file cannot ship without declaring its expectation.
- A new fail-closed `bundle-completeness` gate runs at end-of-change: under `bundle_completeness=strict` (the default) a required-but-missing/empty/invalid file reads "Needs your attention", naming the file and its writer, and blocks via the Stop hook. `warn` surfaces it without blocking; `off` falls back to the deprecated `evidence_existence_gate`. A cache-backfilled file is reported, never passed off as clean; non-feature / no-bundle / CI turns skip the gate.
