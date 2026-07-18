---
'paqad-ai': minor
---

Keep the feature evidence bundle rigid-only, and give the review stage a real artifact.

A feature bundle directory is meant to hold only rigid, script-owned artifacts, but
nothing enforced that. The `review` stage owned no bundle file at all, so its evidence
was an agent-authored markdown file written wherever the model chose — and the HTML
report actively went looking for one, which is how a stray `review-notes.md` and a
duplicate copy of the spec ended up sitting beside the rigid JSON.

- New `paqad-ai review record <template.json>` writes a rigid, schema-validated
  `review.json` into the active feature's bundle, the review stage's counterpart to
  `plan compile` and `spec freeze`. A `review` stage-end that names anything else now
  records inconclusive.
- No stage may prove itself with a non-rigid file written inside a bundle directory,
  and `paqad-ai feature export` reports any stray files it finds.
- `paqad-ai spec freeze` now deletes its transient spec markdown on success (pass
  `--keep-input` to keep it) and refuses a spec authored inside a bundle directory.
- The feature report renders the review from `review.json` instead of reading a
  free-written markdown file.
