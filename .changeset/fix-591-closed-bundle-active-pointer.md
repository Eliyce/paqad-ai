---
'paqad-ai': patch
---

A closed change no longer comes back as the session's active change (#591). After a change passed verification and was closed, the per-session control could still name the closed bundle as `active` — a closed bundle still carries stage rows, so `reconcileSessionControl` returned it as active and the next `stage start` (or live edit) appended into the finished bundle instead of opening a new change.

`reconcileSessionControl` now releases a stale `active` pointer at a currently-closed bundle (its last lifecycle row is a `close`) and falls through to branch-scoped adoption or a fresh mint, so the next stage opens a new change. A dangling pointer at an unmaterialized dir is still left in place (REPOINT-ONLY), and the broad "ever closed" filters (`listAdoptableFeatures`, `sessionClosedAnyFeature`) are unchanged. Reopening a closed change on purpose with `paqad-ai resume --feature <ref>` keeps working: it appends an `open` row (append-only — the `close` row stays) and flips the bundle's status back to `active`, so the next stage row lands there.

Every write of the session control now stamps `written_by` (the writing verb or hook) and the writer's `pid`, so the next stale rewrite is traceable to its source. The fields are additive — a control written before them still reads.
