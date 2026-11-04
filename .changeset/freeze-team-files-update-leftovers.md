---
'paqad-ai': minor
---

Clean up what the last update left behind, and stop team files changing on updates.

Team files now hold `schema_version: 1` instead of a paqad version, and update rewrites one only for a migration, a retired value or setting, or a stale workflow entry. A new setting no longer appears as a comment in them: find it in `.paqad/.config.example` or with `paqad-ai config show`. `.paqad/.config.example` and `.paqad/hook.mjs` no longer hold a version, so they change only when their content does.

The first update swaps the line once. One person updates and commits the swap, then teammates update. Everyone needs this version or newer, including the plugin inside sessions, because a lagging plugin binary comes first on the PATH there.

These 11 settings are removed, because nothing read them: `research_depth`, `full_lane_default`, `require_adversarial_review`, `block_on_stale_docs`, `require_db_review_for_migrations`, `escalate_destructive_operations`, `escalate_risky_migrations`, `escalate_security_findings`, `escalate_db_row_threshold`, `decisions_max_screens_per_task` and `decisions_idle_timeout_minutes`. Update removes a live line once and says so. `feature-development/safety.yaml` goes with them, so update deletes it, or keeps it and says so when it holds notes your team wrote.

Also fixed:

- Update repairs the kept rule lines that point at deleted files, and names any line your team wrote.
- Doctor accepts `ai_attribution` in `commits.yaml`, and no longer reports `commits.yaml` as changed outside the skill right after the first update.
- Update and doctor give the exact lines to add when your hooks folder is tracked. The check is skipped in a terminal where `paqad-ai` is not on the PATH.
- The stub left in `.config.app` has the corrected text and no empty heading.
- Update recompiles stale rules, and `paqad-ai rag refresh-context` does so whatever the route. A failed refresh exits non-zero.
- Doctor checks entry files only for providers the project uses, and warns when the running `paqad-ai` is older than the repo.
- `paqad-ai config effective` names the real reader for every setting.
