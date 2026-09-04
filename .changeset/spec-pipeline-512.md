---
'paqad-ai': minor
---

Spec pipeline (#512), Part A: every `spec freeze` now writes a human-readable
`specification.md` beside the canonical `specification.json` in the feature bundle.

- `specification.md` is a derived, read-only projection rendered from the frozen
  `FeatureSpec` on every freeze, so it can never drift and is never a second source of
  truth (the input-markdown deletion of #402 is unchanged).
- Like `report.html` (#371) it is a non-member sibling: it is not a `FEATURE_BUNDLE_FILES`
  member, the exporter never parses it, and it is git-ignored by the managed `ledger/` line.
- The fail-closed bundle-completeness gate (#511) now pairs the two: a bundle carrying
  `specification.json` must also carry `specification.md`, or the change fails closed under
  strict mode (surfaces as inconclusive under warn).
- The `FeatureSpec` type and schema gain an optional, tolerant `non_goals` field (additive;
  specs authored without it still validate and freeze unchanged).
