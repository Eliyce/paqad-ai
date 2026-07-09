---
'paqad-ai': minor
---

Stage-Spine 05 (#320): artifact-bearing stage markers — prove the work, not just the claim.

A stage-end marker can now carry an artifact the recorder validates over its real
on-disk bytes: `paqad:stage <stage> end -- <path>` (and `paqad-ai stage end <stage>
--artifact <path>`). The thinking stages — planning, specification, review — must
reference a substantive (present, non-empty) artifact to count as complete. A bare
marker pair, a missing file, or an empty file now folds to **inconclusive**, not
complete, and no longer clears the pre-code gate. Mutation stages (development, checks,
documentation_sync) are unchanged — the observed edit is their proof. Reuses the single
`hashArtifacts` path (returns null when no real bytes exist) and preserves same-turn
remediation (#307) and the docs/`.paqad` scope exclusion (#310).
