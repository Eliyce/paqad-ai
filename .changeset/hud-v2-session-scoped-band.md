---
'paqad-ai': minor
---

The Claude Code HUD now shows only the change this session is working on, and says plainly what it does not know.

The band shows a change only when this session is on its branch, on the feature-development route, and has written a stage row for it since the route started. Otherwise it shows `no change in progress`. A verdict shows only when it was written for this change after its latest edit, gates read `not judged yet` until the stage that owns them has ended, and decisions show only for this change. Merge lights only when this change's own pull request is merged, commits count only this change's own, and cost counts only this change's feature-development turns or says `whole session`.

The band is redrawn as one card with three instruments (STAGE, HIGH TABLE and SHIP), can be minimised, closed for the session or hidden for this project, and comes back with `/paqad show`. Other workflows get one status line with their own tokens. The side pane is now the paqad Ledger and opens on Trust. At session start, paqad quietly closes a change as `abandoned` when its branch is gone or merged and it has had no activity for 24 hours.
