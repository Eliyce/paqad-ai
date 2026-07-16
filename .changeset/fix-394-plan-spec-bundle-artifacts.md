---
'paqad-ai': patch
---

fix(#394): feature-development plan/spec must land in the feature bundle

A feature-development change could produce correct code yet write its plan and spec
to an invented `.paqad/features/<slug>/` directory, never creating the bundle's rigid
`plan.json` / `specification.json`, while the stages still read green. Three fixes
close that:

- **Rules (RC-1):** the feature-development rule pack and requirement-analyst agent now
  instruct `paqad-ai plan compile` / `paqad-ai spec freeze` into the bundle and no longer
  name `.paqad/plans/*` or `.paqad/specs/*` as durable write targets.
- **Enforcement (RC-2):** a `planning` / `specification` stage-end whose artifact is not
  the active bundle's `plan.json` / `specification.json` is recorded inconclusive (the
  artifact is dropped so no digest is hashed), with a message naming the compile/freeze
  verb. `review` and the mutation stages are unchanged.
- **Verdict (RC-3):** the end-of-change completeness verdict now asserts the bundle
  actually contains a non-empty `plan.json` and `specification.json`; missing either
  reads incomplete / Needs your attention, never Safe to merge.

The dogfooded fix produced both artifacts in its own feature bundle, and no
`.paqad/features/` directory was created.
