---
'paqad-ai': patch
---

spec-pipeline: the S4 crafting skill now reuses `edge-case-detection` to populate negative
paths and non-goals (B.5.2 / FR-6.1, deferred from #512). `acceptance-criteria-gen` runs
edge-case-detection as a sub-step and folds each surfaced scenario into a flat `AC-n`
negative-path criterion (error/empty/permission paths) or into `## Non-goals` (deliberate
exclusions). The rubric is reused, not cloned, and a new shared parity fixture proves a
negative-path AC + non-goals spec passes both the S4 shape check and the freeze parser.
