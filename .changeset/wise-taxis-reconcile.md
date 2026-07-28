---
'paqad-ai': patch
---

fix(#450): `loadChangeEvidence` now reconciles the session change-artifact
(`.paqad/session/changed-files.json`) against git before trusting it. A stale
artifact left over from an already-delivered change (its files committed and
clean in the working tree) is no longer attributed to a later, unrelated
session — which previously forced the full feature-development stage gate and a
`paqad-ai checks run` onto out-of-scope turns (e.g. a docs-only session). An
artifact entry is now kept only when git still considers it part of the current
change: dirty in the working tree, or committed on this branch since the
merge-base with the base branch. When every entry is stale, evidence falls
through to `git status`; when git cannot be read or has no base branch,
behavior is unchanged (the artifact is trusted). The fix is at the shared
`loadChangeEvidence` chokepoint, so every consumer (completion backstop, checks,
RAG, duplication, rule-scripts) is corrected at once.
