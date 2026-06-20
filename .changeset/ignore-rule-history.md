---
'paqad-ai': patch
---

Ignore the rule-script snapshot directory `.paqad/scripts/rules/.history/` in the managed `.paqad/.gitignore`. It holds per-machine pre-mutation rule snapshots and an events log (the same runtime category as the already-ignored `.cache/` sibling) and should never be committed.
