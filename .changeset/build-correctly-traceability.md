---
'paqad-ai': minor
---

feat: make sure everything promised got built and nothing extra crept in — bidirectional traceability (#109)

Rebuilds a two-way promise ↔ code ↔ test map from reality each run, joining the existing compliance forward link (spec→test), the module map, the import graph, and verification-evidence `ac_id`. Flags promises with no proving check (`TR-UNTESTED-PROMISE`) and code that answers to no promise and that nothing-with-a-promise uses (`TR-CODE-ORPHAN`, decided by reachability over the import graph — not by a label). Shared groundwork passes by _use_; a "this is fine" comment cannot suppress a truly-dead flag. Lane-gated (fast = change-set subset; graduated/full = full build) and written to `.paqad/traceability/map.json`.
