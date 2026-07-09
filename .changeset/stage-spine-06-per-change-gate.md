---
'paqad-ai': minor
---

Stage-Spine 06 (#321): per-change completion gate — stop later changes free-riding on the first.

The end-of-change completeness gate no longer fires only once per session. On a passing
verify, finalize now appends a `close` row and resets the session ledger's `.open` pointer
(`closeSessionOrdinal`), so the next stage/edit opens a fresh ordinal and the pre-code gate
re-arms — change #2+ earns its own verdict instead of inheriting change #1's markers. The
verify-once early return is gone (each Stop re-verifies the open change; the last verify is
the verdict), and the redo cap now counts only failed verifies since the last stage mutation,
so re-verifying never spuriously trips it while a stuck change still marches to `blocked`
(#303 bite-once preserved). Docs-only / `.paqad`-only changes still no-op (#310).
