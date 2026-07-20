---
'paqad-ai': patch
---

Keep one change in one evidence bundle when the session id rotates mid-change (#404).

The active feature is tracked per session, so when the host session id rotated partway
through a change — an app relaunch, a resumed conversation, a rotated `SE_SESSION` — the
new session read a fresh control, found nothing active, and minted a second
`change-<ULID>`. The bundle the change was already recorded in got orphaned, and the
stages recorded before the rotation had to be re-recorded by hand.

A session's control is now reconciled before anything mints: when its active pointer
names no evidence, it is repointed at the in-flight bundle **for the current branch**.
This runs on both the write and the read paths, and from the SessionStart hook so a
rotation is carried over before the agent records anything. It never mints a bundle,
never adopts when two or more changes are in flight on the branch, and never resumes a
feature the session paused.

The branch is what makes this usable. "In flight" alone means real stage rows and no
close row, and that set only grows — an abandoned change and a change shipped without a
passing verdict never get a close row either, so a real repo accumulates them (this one
held 13). Scoped that way, an "exactly one in flight" rule could never fire. A session id
rotates within a change and a change is built on one branch, so the branch identifies the
rotated session's own work, with no clock heuristic and no tunable window. The branch is
stamped on the bundle's `open` row and falls back to the branch `delivery.json` already
recorded; a bundle with no knowable branch is never adopted while on one.

`closeActiveFeature` also stamps a `close` row on the bundle now. Releasing one session's
pointer was previously the only record that a change had finished, which no other session
could see — so adoption would have resurrected it.
