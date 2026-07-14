---
'paqad-ai': patch
---

fix(#380): stage-integrity fixes from the 1.59.0 #356 dogfood RCA

Two deterministic stage-evidence defects surfaced by the #380 RCA are fixed:

- **Orphan feature bundle ("bug #5").** The SessionStart hook now aligns the
  machine-local ledger-session cache to the live host session id. Previously the
  single-slot cache could still hold a prior session's id at the start of a new
  session, so a shell `paqad-ai stage start --title` invoked before the first edit
  minted its feature bundle under a stale session while the PreToolUse gate keyed on
  the true host session — orphaning the bundle and blocking the first edit. This
  extends the bug #5 mitigation from finalization to bundle minting.
- **`documentation_sync` left start-only.** `recordMarkedStage` now forward-closes any
  earlier still-open stage before opening a marked (non-mutation) stage, symmetric with
  the live edit writer. Previously the last mutation stage (e.g. `documentation_sync`)
  had no later mutation edit to close it, so a following marked `review` stage opened
  without closing it and the change was left with a dangling open stage.
